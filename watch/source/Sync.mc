using Toybox.Application.Storage;
using Toybox.Background;
using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

module Sync {
    var busy = false;
    var message = "Offline ready";
    var nextAt = 0;
    var failures = 0;
    var sent = [];
    var page = 0;
    var incoming = [];
    var results = null;
    var snapshot = null;

    function run(force) {
        if (busy || (!force && Time.now().value() < nextAt)) { return; }
        if (!System.getDeviceSettings().phoneConnected) { message = "Phone offline"; WatchUi.requestUpdate(); return; }
        busy = true;
        page = 0;
        incoming = [];
        results = null;
        snapshot = null;
        message = "Syncing...";
        var q = Model.queue().slice(0,8);
        sent = q;
        request(q.size() > 0 ? { "changes" => q } : null, q.size() > 0 ? new Lang.Method(Sync,:uploaded) : new Lang.Method(Sync,:downloaded));
    }

    function request(body, callback) {
        try {
            Communications.makeWebRequest(Secrets.API + (body == null ? pageQuery(page,snapshot) : ""), body, {
                :method => body == null ? Communications.HTTP_REQUEST_METHOD_GET : Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Authorization" => "Bearer " + Secrets.TOKEN,
                    "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            }, callback);
        } catch (e) { failed(-1); }
    }

    function failed(code) {
        busy = false;
        failures++;
        nextAt = Time.now().value() + (failures < 3 ? 30 : 300);
        message = code == 401 ? "Key disconnected" : "Sync pending";
        WatchUi.requestUpdate();
    }

    function uploaded(code, data) {
        if (code != 200 || !(data instanceof Lang.Dictionary) || !(data["results"] instanceof Lang.Array)) { failed(code); return; }
        results = data["results"];
        request(null, new Lang.Method(Sync,:downloaded));
    }

    function downloaded(code, data) {
        if (code != 200 || !(data instanceof Lang.Dictionary) || !(data["items"] instanceof Lang.Array)) { failed(code); return; }
        incoming.addAll(data["items"]);
        if (page == 0) { snapshot = data; }
        page++;
        if (page < snapshot["pages"]) { request(null, new Lang.Method(Sync,:downloaded)); return; }
        // Only acknowledge the outbox when a complete replacement snapshot exists.
        Outbox.ack(results);
        snapshot["items"] = incoming;
        if (!Model.accept(snapshot)) { failed(code); return; }
        snapshot = null;
        incoming = [];
        busy = false;
        failures = 0;
        nextAt = Time.now().value() + 300;
        message = Storage.getValue("conflict") == true ? "Newer phone edit kept" : "Up to date";
        Model.note = message;
        WatchUi.requestUpdate();
    }
}

(:background)
function pageQuery(page,snapshot) {
    if (page == 0 || snapshot == null) { return "?page=0"; }
    var ids = snapshot["ids"];
    var query = "?ids=";
    for(var i=page*5;i<ids.size() && i<(page+1)*5;i++) {
        if(i>page*5) { query+=","; }
        query+=ids[i];
    }
    return query;
}

(:background)
module Outbox {
    function ack(results) {
        if (results == null) { return; }
        var q = Storage.getValue("queue");
        var keep = [];
        for (var i = 0; q != null && i < q.size(); i++) {
            var ack = false;
            for (var j = 0; j < results.size(); j++) {
                var r = results[j];
                if (q[i]["id"].equals(r["id"])) {
                    ack = true;
                    if (!r["state"].equals("applied")) { Storage.setValue("conflict", true); }
                }
            }
            if (!ack) { keep.add(q[i]); }
        }
        Storage.setValue("queue", keep);
    }
}

// The background process only touches the small outbox and glance summary.
// It never loads the full assignment cache or any foreground views.
(:background)
class DatebookService extends System.ServiceDelegate {
    var page = 0;
    var prefix = "c";
    var results = null;
    var snapshot = null;
    function initialize() { ServiceDelegate.initialize(); }
    function onTemporalEvent() {
        if (!System.getDeviceSettings().phoneConnected) { Background.exit(null); return; }
        var q = Storage.getValue("queue");
        if (q != null) { q = q.slice(0,8); }
        var current = Storage.getValue("cache");
        prefix = current != null && current["prefix"].equals("c") ? "d" : "c";
        if (q != null && q.size() > 0) { send({ "changes" => q }, false); }
        else { send(null, true); }
    }
    function send(body, summary) {
        try {
            Communications.makeWebRequest(Secrets.API + (summary ? pageQuery(page,snapshot) : ""), body, {
                :method => summary ? Communications.HTTP_REQUEST_METHOD_GET : Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Authorization" => "Bearer " + Secrets.TOKEN, "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            }, summary ? method(:summaryDone) : method(:uploadDone));
        } catch (e) { Background.exit(null); }
    }
    function uploadDone(code, data) {
        if (code != 200 || !(data instanceof Lang.Dictionary) || !(data["results"] instanceof Lang.Array)) { Background.exit(code); return; }
        results = data["results"];
        send(null, true);
    }
    function summaryDone(code, data) {
        if (code != 200 || !(data instanceof Lang.Dictionary) || !(data["items"] instanceof Lang.Array)) { Background.exit(code); return; }
        Storage.setValue(prefix + page, data["items"]);
        if (page == 0) {
            snapshot = data;
            // Keep only metadata, never accumulate pages in the 64KB process.
            snapshot["items"] = [];
        }
        page++;
        if (page < snapshot["pages"]) { send(null,true); return; }
        Storage.setValue("cache", { "prefix" => prefix, "chunks" => page, "classes" => snapshot["classes"] });
        Storage.setValue("syncedAt", snapshot["syncedAt"]);
        Storage.setValue("limited", snapshot["limited"]);
        Storage.setValue("summary", { "open" => snapshot["open"], "next" => snapshot["next"], "syncedAt" => snapshot["syncedAt"] });
        Outbox.ack(results);
        Background.exit(code);
    }
}
