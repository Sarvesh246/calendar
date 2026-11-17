using Toybox.Application.Storage;
using Toybox.Cryptography;
using Toybox.Lang;
using Toybox.Time;
using Toybox.Time.Gregorian;

module Model {
    var items = [];
    var classes = [];
    var note = "";
    var ready = false;

    function load() {
        if (ready) { return; }
        ready = true;
        var manifest = Storage.getValue("cache");
        var prefix = manifest == null ? "items" : manifest["prefix"];
        var count = manifest == null ? Storage.getValue("chunks") : manifest["chunks"];
        if (count != null) {
            for (var i = 0; i < count; i++) {
                var chunk = Storage.getValue(prefix + i);
                if (chunk != null) { items.addAll(chunk); }
            }
        }
        var c = manifest == null ? Storage.getValue("classes") : manifest["classes"];
        if (c != null) { classes = c; }
        if (items.size() == 0 && Storage.getValue("seeded") == null) {
            items = Seed.items();
            classes = Seed.classes();
            Storage.setValue("syncedAt",Seed.syncedAt());
            Storage.setValue("limited",Seed.limited());
            save();
            Storage.setValue("seeded", true);
        }
        overlay();
    }

    function queue() {
        var q = Storage.getValue("queue");
        return q == null ? [] : q;
    }

    function save() {
        // Double-buffer the cache: commit a pointer only after every chunk is written.
        var current = Storage.getValue("cache");
        var prefix = current != null && current["prefix"].equals("a") ? "b" : "a";
        var count = (items.size() + 4) / 5;
        for (var i = 0; i < count; i++) {
            var chunk = [];
            for (var j = i * 5; j < items.size() && j < (i + 1) * 5; j++) { chunk.add(items[j]); }
            Storage.setValue(prefix + i, chunk);
        }
        Storage.setValue("cache", { "prefix" => prefix, "chunks" => count, "classes" => classes });
        summary();
    }

    function summary() {
        var count = 0;
        var title = "All caught up";
        for (var i = 0; i < items.size(); i++) {
            if (!items[i]["type"].equals("event") && !items[i]["status"].equals("done")) {
                if (count == 0) { title = items[i]["title"]; }
                count++;
            }
        }
        Storage.setValue("summary", { "open" => count, "next" => title, "syncedAt" => lastSync() });
    }

    function lastSync() {
        var s = Storage.getValue("syncedAt");
        return s == null ? 0 : s;
    }

    function reload() { ready=false; items=[]; classes=[]; load(); }

    function accept(data) {
        if (!(data instanceof Lang.Dictionary) || !(data["items"] instanceof Lang.Array)) { return false; }
        items = data["items"];
        classes = data["classes"];
        Storage.setValue("syncedAt", data["syncedAt"]);
        Storage.setValue("limited", data["limited"]);
        overlay();
        save();
        return true;
    }

    function find(id) {
        for (var i = 0; i < items.size(); i++) { if (items[i]["id"].equals(id)) { return items[i]; } }
        return null;
    }

    function uuid() {
        var b = Cryptography.randomBytes(16);
        var s = "";
        for (var i = 0; i < 16; i++) {
            var v = b[i];
            if (i == 6) { v = (v & 15) | 64; }
            if (i == 8) { v = (v & 63) | 128; }
            s += v.format("%02x");
            if (i == 3 || i == 5 || i == 7 || i == 9) { s += "-"; }
        }
        return s;
    }

    function change(item, action, value, subtaskId) {
        var q = queue();
        if (q.size() >= 30) { note = "30 changes saved. Sync before editing more."; return false; }
        var op = { "id" => uuid(), "itemId" => item["id"], "action" => action,
            "value" => value, "changedAt" => Time.now().value(), "base" => item["updatedAt"] };
        if (subtaskId != null) { op["subtaskId"] = subtaskId; }
        q.add(op);
        // Persist the outbox first. It survives loss of power during cache writes.
        try { Storage.setValue("queue", q); } catch (e) { note = "Storage full. Change was not saved."; return false; }
        apply(item, op);
        save();
        note = "Saved on watch";
        return true;
    }

    function apply(item, op) {
        var a = op["action"];
        if (a.equals("status")) { item["status"] = op["value"]; }
        if (a.equals("priority")) { item["priority"] = op["value"]; }
        if (a.equals("rename")) { item["title"] = op["value"]; }
        if (a.equals("class")) {
            item["categoryId"] = op["value"];
            for(var k=0;k<classes.size();k++) { if(classes[k]["id"].equals(op["value"])) { item["class"]=classes[k]["name"]; } }
        }
        if (a.equals("plan") && find(op["id"])==null) {
            var session=task(op["id"],"Work: "+item["title"],op["changedAt"]);
            session["type"]="event"; session["end"]=op["changedAt"]+op["value"].toNumber()*60;
            session["allDay"]=false; session["class"]=item["class"]; session["categoryId"]=item["categoryId"];
            items.add(session);
        }
        if (a.equals("reschedule")) { item["at"] = op["value"].toNumber(); }
        if (a.equals("subtask")) {
            var steps = item["subtasks"];
            for (var j = 0; j < steps.size(); j++) {
                if (steps[j]["id"].equals(op["subtaskId"])) { steps[j]["done"] = op["value"].equals("true"); }
            }
        }
    }

    function overlay() {
        var q = queue();
        for (var i = 0; i < q.size(); i++) {
            var item = find(q[i]["itemId"]);
            if (item != null) { apply(item, q[i]); }
            else if (q[i]["action"].equals("create")) { items.add(task(q[i]["itemId"], q[i]["value"], q[i]["changedAt"])); }
        }
    }

    function task(id, title, at) {
        return { "id" => id, "title" => title, "class" => "No class", "type" => "task",
            "at" => at, "end" => 0, "allDay" => true, "status" => "todo", "statusAt" => 0,
            "updatedAt" => 0, "description" => "", "location" => "", "priority" => "normal", "subtasks" => [] };
    }

    function addTask(title) {
        var item = task(uuid(), title, Time.now().value());
        if (change(item, "create", title, null)) { items.add(item); save(); return true; }
        return false;
    }

    function dayKey(at) {
        var d = Gregorian.info(new Time.Moment(at), Time.FORMAT_SHORT);
        return d.year * 10000 + d.month * 100 + d.day;
    }

    function list(mode, category) {
        var result = [];
        var now = Time.now().value();
        var today = dayKey(now);
        for (var i = 0; i < items.size(); i++) {
            var item = items[i];
            var done = item["status"].equals("done");
            var work = !item["type"].equals("event");
            var due = dayKey(item["at"]);
            if (mode instanceof Lang.Number && due != mode) { continue; }
            if (category != null && !category.equals(item["categoryId"])) { continue; }
            if (mode == :open && (!work || done)) { continue; }
            if (mode == :today && due != today) { continue; }
            if (mode == :overdue && (!work || done || due >= today)) { continue; }
            if (mode == :doing && (!work || !item["status"].equals("doing"))) { continue; }
            if (mode == :done && (!work || !done)) { continue; }
            if (mode == :agenda && (done || due < today)) { continue; }
            result.add(item);
        }
        // The cache is small; insertion sort avoids comparator-object allocation.
        for (var k=1;k<result.size();k++) {
            var selected=result[k];
            var at=k-1;
            while(at>=0 && byDate(result[at],selected)>0) { result[at+1]=result[at]; at--; }
            result[at+1]=selected;
        }
        return result;
    }
    function byDate(a, b) { return a["at"] < b["at"] ? -1 : (a["at"] == b["at"] ? 0 : 1); }
    function status(item) {
        if (item["type"].equals("event")) { return "Event"; }
        return item["status"].equals("done") ? "Done" : (item["status"].equals("doing") ? "In progress" : "To do");
    }
    function date(item) {
        var d = Gregorian.info(new Time.Moment(item["at"]), Time.FORMAT_MEDIUM);
        var s = d.month + " " + d.day;
        if (!item["allDay"]) {
            var t = Gregorian.info(new Time.Moment(item["at"]), Time.FORMAT_SHORT);
            s += "  " + t.hour.format("%02d") + ":" + t.min.format("%02d");
        }
        return s;
    }
}

