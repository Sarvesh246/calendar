using Toybox.Graphics;
using Toybox.Lang;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.WatchUi;

class MonthView extends WatchUi.View {
    var selected;
    var target;
    var first=0;
    var offset=0;
    function initialize(itemId) {
        View.initialize(); target=itemId;
        var item=itemId==null?null:Model.find(itemId);
        selected=item==null?Time.now().value():item["at"];
    }
    function move(days) { selected+=days*86400; WatchUi.requestUpdate(); }
    function month(direction) {
        var original=Gregorian.info(new Time.Moment(selected),Time.FORMAT_SHORT).month;
        while(Gregorian.info(new Time.Moment(selected),Time.FORMAT_SHORT).month==original) { selected+=direction*86400; }
        WatchUi.requestUpdate();
    }
    function onUpdate(dc) {
        Paint.clear(dc);
        var date=Gregorian.info(new Time.Moment(selected),Time.FORMAT_SHORT);
        var longDate=Gregorian.info(new Time.Moment(selected),Time.FORMAT_MEDIUM);
        Paint.line(dc,57,Graphics.FONT_SMALL,longDate.month+" "+date.year,Paint.GREEN);
        first=selected-(date.day-1)*86400;
        offset=Gregorian.info(new Time.Moment(first),Time.FORMAT_SHORT).day_of_week-1;
        var days=["S","M","T","W","T","F","S"];
        for(var c=0;c<7;c++) {
            dc.setColor(Paint.MUTED,Graphics.COLOR_TRANSPARENT);
            dc.drawText(75+c*40,99,Graphics.FONT_XTINY,days[c],Paint.CENTER);
        }
        for(var d=1;d<=31;d++) {
            var epoch=first+(d-1)*86400;
            if(Gregorian.info(new Time.Moment(epoch),Time.FORMAT_SHORT).month!=date.month) { break; }
            var cell=offset+d-1;
            var x=75+(cell%7)*40;
            var y=136+(cell/7).toNumber()*30;
            if(d==date.day) { dc.setColor(Paint.GREEN,Graphics.COLOR_TRANSPARENT); dc.fillCircle(x,y,17); }
            dc.setColor(d==date.day?0x000000:Paint.WHITE,Graphics.COLOR_TRANSPARENT);
            dc.drawText(x,y,Graphics.FONT_XTINY,d.toString(),Paint.CENTER);
        }
        var count=Model.list(Model.dayKey(selected),null).size();
        Paint.line(dc,319,Graphics.FONT_XTINY,longDate.month+" "+date.day+" / "+count+" items",Paint.MUTED);
        Paint.line(dc,350,Graphics.FONT_XTINY,target==null?"Open day":"Choose date",Paint.GREEN);
    }
    function choose() {
        if(target==null) { Nav.list(Model.dayKey(selected),null,"Selected day"); }
        else {
            var item=Model.find(target);
            if(item!=null) { Model.change(item,"reschedule",selected.toString(),null); Sync.run(true); }
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        }
    }
}
class MonthDelegate extends WatchUi.BehaviorDelegate {
    var view;
    function initialize(v) { BehaviorDelegate.initialize(); view=v; }
    function onNextPage() { view.move(1); return true; }
    function onPreviousPage() { view.move(-1); return true; }
    function onSelect() { view.choose(); return true; }
    function onBack() { WatchUi.popView(WatchUi.SLIDE_RIGHT); return true; }
    function onMenu() {
        var m=new WatchUi.Menu2({:title=>"Month"});
        Nav.add(m,"Previous month",null,-1); Nav.add(m,"Next month",null,1);
        Nav.push(m,new MonthMenu(view)); return true;
    }
    function onTap(evt) {
        var p=evt.getCoordinates();
        if(p[0]>=55 && p[0]<335 && p[1]>=121 && p[1]<301) {
            var cell=((p[1]-121)/30).toNumber()*7+((p[0]-55)/40).toNumber();
            var day=cell-view.offset;
            if(day>=0 && day<31) {
                var candidate=view.first+day*86400;
                if(Gregorian.info(new Time.Moment(candidate),Time.FORMAT_SHORT).month==Gregorian.info(new Time.Moment(view.selected),Time.FORMAT_SHORT).month) { view.selected=candidate; WatchUi.requestUpdate(); }
            }
        } else if(p[1]>=301) { view.choose(); }
        return true;
    }
}
class MonthMenu extends WatchUi.Menu2InputDelegate {
    var view;
    function initialize(v) { Menu2InputDelegate.initialize(); view=v; }
    function onSelect(item) { view.month(item.getId()); WatchUi.popView(WatchUi.SLIDE_DOWN); }
}
