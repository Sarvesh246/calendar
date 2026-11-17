using Toybox.Application.Storage;
using Toybox.Attention;
using Toybox.Graphics;
using Toybox.Math;
using Toybox.Time;
using Toybox.Timer;
using Toybox.WatchUi;

module Paint {
    const GREEN = 0xB5F5C3;
    const MUTED = 0xA8B4AE;
    const WHITE = 0xF6F8F6;
    const AMBER = 0xFFD18C;
    const CENTER = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
    function clear(dc) { dc.setColor(0x000000,0x000000); dc.clear(); }
    // Width is computed from both the top and bottom of each text box,
    // with a 20px inset inside the circular bezel.
    function width(dc,y,font) {
        var r = dc.getWidth()/2.0;
        var d = (y-r).abs()+dc.getFontHeight(font)/2.0;
        return d >= r ? 0 : (2*Math.sqrt(r*r-d*d)-40).toNumber();
    }
    function line(dc,y,font,text,color) {
        var w = width(dc,y,font);
        var s = text.toString();
        if (dc.getTextWidthInPixels(s,font)>w) {
            while (s.length()>0 && dc.getTextWidthInPixels(s+"...",font)>w) { s=s.substring(0,s.length()-1); }
            s += "...";
        }
        dc.setColor(color,Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth()/2,y,font,s,CENTER);
    }
    function wrap(dc,text,font,w) {
        var result=[];
        var line="";
        for (var i=0;i<text.length();i++) {
            var c=text.substring(i,i+1);
            if (c.equals("\n")) { result.add(line); line=""; continue; }
            if (dc.getTextWidthInPixels(line+c,font)>w && line.length()>0) {
                var cut=-1;
                for(var j=0;j<line.length();j++) { if(line.substring(j,j+1).equals(" ")) { cut=j; } }
                if(cut>0) { result.add(line.substring(0,cut)); line=line.substring(cut+1,line.length())+c; }
                else { result.add(line); line=c; }
            } else { line+=c; }
        }
        if(line.length()>0) { result.add(line); }
        return result;
    }
    function title(dc,text) {
        var lines=wrap(dc,text,Graphics.FONT_SMALL,280);
        for(var i=0;i<lines.size() && i<3;i++) { line(dc,130+i*36,Graphics.FONT_SMALL,lines[i],WHITE); }
    }
    function buzz() { try { Attention.vibrate([new Attention.VibeProfile(45,60)]); } catch(e) { } }
}

class HomeView extends WatchUi.View {
    function initialize() { View.initialize(); }
    function onUpdate(dc) {
        Paint.clear(dc);
        Paint.line(dc,48,Graphics.FONT_XTINY,"DATEBOOK",Paint.GREEN);
        var n=Model.list(:open,null).size();
        Paint.line(dc,106,Graphics.FONT_NUMBER_HOT,n.toString(),Paint.WHITE);
        Paint.line(dc,159,Graphics.FONT_XTINY,"OPEN WORK",Paint.MUTED);
        var overdue=Model.list(:overdue,null).size();
        var today=Model.list(:today,null).size();
        Paint.line(dc,209,Graphics.FONT_XTINY,today+" today / "+overdue+" overdue",overdue>0?Paint.AMBER:Paint.GREEN);
        dc.setColor(0x263B2D,Graphics.COLOR_TRANSPARENT); dc.fillRoundedRectangle(62,241,266,49,16);
        Paint.line(dc,266,Graphics.FONT_XTINY,"Open Datebook",Paint.GREEN);
        var q=Model.queue().size();
        var label=q>0?q+" changes waiting":Sync.message;
        Paint.line(dc,315,Graphics.FONT_XTINY,label,Paint.MUTED);
        var last=Model.lastSync();
        var age=last==0?"Never synced":((Time.now().value()-last)/60).toNumber()+"m ago";
        Paint.line(dc,347,Graphics.FONT_XTINY,age,Paint.MUTED);
    }
}
class HomeDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }
    function onSelect() { Nav.home(); return true; }
    function onMenu() { Nav.home(); return true; }
    function onTap(evt) { Nav.home(); return true; }
}

class DetailView extends WatchUi.View {
    var id;
    var page=0;
    var pages=1;
    function initialize(itemId) { View.initialize(); id=itemId; }
    function onUpdate(dc) {
        Paint.clear(dc);
        var item=Model.find(id);
        if(item==null) { Paint.line(dc,195,Graphics.FONT_SMALL,"Item removed on phone",Paint.MUTED); return; }
        var text=item["title"]+"\n"+Model.date(item)+"\n"+item["class"];
        if(item["location"].length()>0) { text+="\n"+item["location"]; }
        if(item["description"].length()>0) { text+="\n\n"+item["description"]; }
        if(item["description"].length()>=600) { text+="\n[More in Datebook]"; }
        var lines=Paint.wrap(dc,text,Graphics.FONT_SMALL,278);
        pages=(lines.size()+4)/5;
        if(page>=pages) { page=pages-1; }
        Paint.line(dc,48,Graphics.FONT_XTINY,Model.status(item),item["status"].equals("done")?Paint.GREEN:Paint.AMBER);
        for(var i=0;i<5 && page*5+i<lines.size();i++) { Paint.line(dc,116+i*37,Graphics.FONT_SMALL,lines[page*5+i],Paint.WHITE); }
        Paint.line(dc,318,Graphics.FONT_XTINY,(page+1)+" / "+pages+"  UP/DOWN",Paint.MUTED);
        Paint.line(dc,350,Graphics.FONT_XTINY,"Actions",Paint.GREEN);
    }
    function move(delta) { page=(page+delta+pages)%pages; WatchUi.requestUpdate(); }
}
class DetailDelegate extends WatchUi.BehaviorDelegate {
    var view;
    function initialize(v) { BehaviorDelegate.initialize(); view=v; }
    function onNextPage() { view.move(1); return true; }
    function onPreviousPage() { view.move(-1); return true; }
    function onSelect() { Nav.actions(view.id); return true; }
    function onMenu() { return onSelect(); }
    function onTap(evt) { return onSelect(); }
    function onBack() { WatchUi.popView(WatchUi.SLIDE_RIGHT); return true; }
}

class FocusView extends WatchUi.View {
    var id;
    var timer;
    function initialize(itemId) { View.initialize(); id=itemId; }
    function onShow() { timer=new Timer.Timer(); timer.start(method(:tick),1000,true); }
    function onHide() { if(timer!=null) { timer.stop(); } }
    function tick() { WatchUi.requestUpdate(); }
    function onUpdate(dc) {
        Paint.clear(dc);
        var finish=Storage.getValue("focusEnd");
        var remaining=finish==null?0:finish-Time.now().value();
        if(remaining<0) { remaining=0; }
        Paint.line(dc,64,Graphics.FONT_XTINY,"FOCUS",Paint.GREEN);
        Paint.line(dc,166,Graphics.FONT_NUMBER_MEDIUM,(remaining/60).toNumber().format("%02d")+":"+(remaining%60).format("%02d"),Paint.WHITE);
        Paint.line(dc,244,Graphics.FONT_SMALL,remaining==0?"Session complete":"One thing at a time",Paint.GREEN);
        Paint.line(dc,308,Graphics.FONT_XTINY,"BACK to keep working",Paint.MUTED);
    }
}
