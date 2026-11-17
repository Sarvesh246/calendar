using Toybox.Application;
using Toybox.Application.Storage;
using Toybox.Background;
using Toybox.Graphics;
using Toybox.Lang;
using Toybox.Time;
using Toybox.Timer;
using Toybox.WatchUi;

(:background, :glance)
class DatebookApp extends Application.AppBase {
    var timer = null;
    function initialize() { AppBase.initialize(); }
    function getGlanceView() { return [new DatebookGlance()]; }
    function getServiceDelegate() { return [new DatebookService()]; }
    function getInitialView() {
        Model.load();
        try { Background.registerForTemporalEvent(new Time.Duration(900)); } catch (e) { }
        Sync.run(false);
        timer = new Timer.Timer();
        timer.start(method(:tick), 30000, true);
        return [new HomeView(), new HomeDelegate()];
    }
    function tick() { Sync.run(false); WatchUi.requestUpdate(); }
    function onStop(state) { if (timer != null) { timer.stop(); } }
    function onBackgroundData(data) { if (timer != null) { Model.reload(); } WatchUi.requestUpdate(); }
}

(:glance)
class DatebookGlance extends WatchUi.GlanceView {
    function initialize() { GlanceView.initialize(); }
    function onUpdate(dc) {
        dc.setColor(0x000000,0x000000); dc.clear();
        var summary = Storage.getValue("summary");
        var title = "Open to sync";
        var count = "DATEBOOK";
        if (summary != null) { count = summary["open"].toString() + " OPEN"; title = summary["next"]; }
        // Garmin places the glance canvas beside its own icon. Keep both
        // lines in the central band so the circular list mask cannot clip them.
        var width = dc.getWidth() - 30;
        while (title.length() > 1 && dc.getTextWidthInPixels(title,Graphics.FONT_XTINY) > width) { title = title.substring(0,title.length()-2) + "~"; }
        dc.setColor(0xB5F5C3,Graphics.COLOR_TRANSPARENT);
        dc.drawText(8,dc.getHeight()/2-25,Graphics.FONT_XTINY,count,Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(0xFFFFFF,Graphics.COLOR_TRANSPARENT);
        dc.drawText(8,dc.getHeight()/2+4,Graphics.FONT_XTINY,title,Graphics.TEXT_JUSTIFY_LEFT);
    }
}
