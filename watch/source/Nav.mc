using Toybox.Application.Storage;
using Toybox.Time;
using Toybox.WatchUi;

module Nav {
    function add(menu,label,sub,id) { menu.addItem(new WatchUi.MenuItem(label,sub,id,null)); }
    function push(menu,delegate) { WatchUi.pushView(menu,delegate,WatchUi.SLIDE_UP); }
    function home() {
        var m=new WatchUi.Menu2({:title=>"Datebook"});
        add(m,"Today",Model.list(:today,null).size()+" items",:today);
        add(m,"Calendar","Browse dates",:calendar);
        add(m,"Open work",Model.list(:open,null).size()+" assignments & tasks",:open);
        add(m,"Overdue",Model.list(:overdue,null).size()+" incomplete",:overdue);
        add(m,"In progress",Model.list(:doing,null).size()+" started",:doing);
        add(m,"Agenda","Upcoming events & deadlines",:agenda);
        add(m,"Classes","Browse by class",:classes);
        add(m,"Completed","Reopen completed work",:done);
        add(m,"Add task","Saved offline, due today",:add);
        add(m,"Search","Find cached items",:search);
        add(m,"Sync now",Model.queue().size()+" changes waiting",:sync);
        add(m,"Sync details",Sync.message,:info);
        push(m,new MainMenu());
    }
    function list(mode,category,title) {
        var items=Model.list(mode,category);
        var m=new WatchUi.Menu2({:title=>title});
        for(var i=0;i<items.size();i++) {
            var item=items[i];
            add(m,item["title"],Model.date(item)+" / "+Model.status(item),item["id"]);
        }
        if(items.size()==0) { add(m,"Nothing here","BACK to Datebook",:empty); }
        push(m,new ItemMenu());
    }
    function classes() {
        var m=new WatchUi.Menu2({:title=>"Classes"});
        for(var i=0;i<Model.classes.size();i++) {
            var c=Model.classes[i];
            add(m,c["name"],Model.list(:all,c["id"]).size()+" cached items",c["id"]);
        }
        if(Model.classes.size()==0) { add(m,"No classes cached","Sync to load classes",:empty); }
        push(m,new ClassMenu());
    }
    function detail(id) { var view=new DetailView(id); push(view,new DetailDelegate(view)); }
    function actions(id) {
        var item=Model.find(id);
        if(item==null) { return; }
        var m=new WatchUi.Menu2({:title=>"Actions"});
        if(!item["type"].equals("event")) {
            add(m,"Mark done",item["status"].equals("done")?"Current status":"Complete this item",:done);
            add(m,"In progress",item["status"].equals("doing")?"Current status":"Start working",:doing);
            add(m,"To do / incomplete",item["status"].equals("todo")?"Current status":"Reopen this item",:todo);
            add(m,"Checklist",item["subtasks"].size()+" steps",:steps);
            add(m,"Priority",item["priority"],:priority);
            add(m,"Focus 25 minutes","Start a focus timer",:focus);
            add(m,"Plan work session","Adds time, keeps the deadline",:plan);
        }
        add(m,"Edit title",null,:rename);
        add(m,"Change class",null,:class);
        add(m,"Reminder","Replaces time reminders",:reminder);
        add(m,"Choose date","Moves the deadline",:date);
        add(m,"Move to tomorrow","Moves the deadline",:tomorrow);
        add(m,"Move by 1 week","Moves the deadline",:week);
        push(m,new ActionMenu(id));
    }
    function info() {
        var m=new WatchUi.Menu2({:title=>"Sync details"});
        add(m,Sync.message,Model.queue().size()+" saved changes",:empty);
        add(m,"Last full sync",Model.lastSync()==0?"Never":((Time.now().value()-Model.lastSync())/60).toNumber()+" minutes ago",:empty);
        add(m,Model.items.size()+" items on watch",Storage.getValue("limited")==true?"Cache limit: nearest 100 items":"Offline cache ready",:empty);
        add(m,"Phone + Garmin Connect","Bluetooth and internet for sync",:empty);
        add(m,"Background: every 15 min","Garmin may delay to save battery",:empty);
        if(Storage.getValue("conflict")==true) { add(m,"A newer edit was kept","Review items, then dismiss notice",:clear); }
        push(m,new InfoMenu());
    }
}
class MainMenu extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }
    function onSelect(item) {
        var id=item.getId();
        if(id==:classes) { Nav.classes(); }
        else if(id==:calendar) { var v=new MonthView(null); Nav.push(v,new MonthDelegate(v)); }
        else if(id==:search) { Nav.push(new WatchUi.TextPicker(""),new SearchText()); }
        else if(id==:sync) { Sync.run(true); WatchUi.popView(WatchUi.SLIDE_DOWN); }
        else if(id==:info) { Nav.info(); }
        else if(id==:add) {
            if(WatchUi has :TextPicker) { Nav.push(new WatchUi.TextPicker(""),new TaskText()); }
        } else { Nav.list(id,null,item.getLabel()); }
    }
}
class ItemMenu extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }
    function onSelect(item) { if(item.getId()!=:empty) { Nav.detail(item.getId()); } }
}
class ClassMenu extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }
    function onSelect(item) { if(item.getId()!=:empty) { Nav.list(:all,item.getId(),item.getLabel()); } }
}
class InfoMenu extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }
    function onSelect(item) { if(item.getId()==:clear) { Storage.deleteValue("conflict"); WatchUi.popView(WatchUi.SLIDE_DOWN); } }
}
class TaskText extends WatchUi.TextPickerDelegate {
    function initialize() { TextPickerDelegate.initialize(); }
    function onTextEntered(text,changed) {
        if(text.length()>0 && text.length()<=240 && Model.addTask(text)) { Paint.buzz(); Sync.run(true); }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
    function onCancel() { WatchUi.popView(WatchUi.SLIDE_DOWN); return true; }
}
class ActionMenu extends WatchUi.Menu2InputDelegate {
    var id;
    function initialize(itemId) { Menu2InputDelegate.initialize(); id=itemId; }
    function onSelect(menuItem) {
        var action=menuItem.getId();
        var item=Model.find(id);
        if(item==null) { return; }
        if(action==:steps) {
            var m=new WatchUi.Menu2({:title=>"Checklist"});
            for(var i=0;i<item["subtasks"].size();i++) {
                var s=item["subtasks"][i];
                Nav.add(m,s["title"],s["done"]?"Done - select to reopen":"To do - select to complete",s["id"]);
            }
            if(item["subtasks"].size()==0) { Nav.add(m,"No checklist","Add steps in Datebook",:empty); }
            Nav.push(m,new StepMenu(id)); return;
        }
        if(action==:rename) { Nav.push(new WatchUi.TextPicker(item["title"]),new RenameText(id)); return; }
        if(action==:date) { var dateView=new MonthView(id); Nav.push(dateView,new MonthDelegate(dateView)); return; }
        if(action==:class || action==:reminder || action==:plan) {
            var choices=new WatchUi.Menu2({:title=>action==:class?"Class":(action==:plan?"Plan work":"Reminder")});
            if(action==:class) {
                for(var k=0;k<Model.classes.size();k++) { Nav.add(choices,Model.classes[k]["name"],null,Model.classes[k]["id"]); }
            } else if(action==:plan) {
                Nav.add(choices,"25 minutes","Start now, deadline unchanged","25"); Nav.add(choices,"50 minutes","Start now, deadline unchanged","50");
            } else {
                Nav.add(choices,"10 minutes before",null,"10"); Nav.add(choices,"30 minutes before",null,"30");
                Nav.add(choices,"1 hour before",null,"60"); Nav.add(choices,"1 day before",null,"1440");
            }
            Nav.push(choices,new FieldMenu(id,action==:class?"class":(action==:plan?"plan":"reminder"))); return;
        }
        if(action==:priority) {
            var p=new WatchUi.Menu2({:title=>"Priority"});
            Nav.add(p,"High",null,"high"); Nav.add(p,"Normal",null,"normal"); Nav.add(p,"Low",null,"low");
            Nav.push(p,new PriorityMenu(id)); return;
        }
        if(action==:tomorrow || action==:week) {
            var c=new WatchUi.Menu2({:title=>"Move deadline?"});
            Nav.add(c,"Keep current date",Model.date(item),:cancel);
            Nav.add(c,"Move deadline",action==:tomorrow?"Tomorrow, same time":"7 days later, same time",action);
            Nav.push(c,new MoveMenu(id)); return;
        }
        if(action==:focus) {
            Storage.setValue("focusEnd",Time.now().value()+1500);
            Nav.push(new FocusView(id),new WatchUi.BehaviorDelegate()); return;
        }
        var value=action==:done?"done":(action==:doing?"doing":"todo");
        if(Model.change(item,"status",value,null)) { Paint.buzz(); Sync.run(true); }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
class PriorityMenu extends WatchUi.Menu2InputDelegate {
    var id;
    function initialize(itemId) { Menu2InputDelegate.initialize(); id=itemId; }
    function onSelect(item) { var target=Model.find(id); if(target!=null) { Model.change(target,"priority",item.getId(),null); Sync.run(true); } WatchUi.popView(WatchUi.SLIDE_DOWN); }
}
class StepMenu extends WatchUi.Menu2InputDelegate {
    var id;
    function initialize(itemId) { Menu2InputDelegate.initialize(); id=itemId; }
    function onSelect(item) {
        if(item.getId()==:empty) { return; }
        var target=Model.find(id);
        if(target==null) { return; }
        for(var i=0;i<target["subtasks"].size();i++) {
            var s=target["subtasks"][i];
            if(s["id"].equals(item.getId())) { Model.change(target,"subtask",s["done"]?"false":"true",s["id"]); }
        }
        Sync.run(true); WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
class MoveMenu extends WatchUi.Menu2InputDelegate {
    var id;
    function initialize(itemId) { Menu2InputDelegate.initialize(); id=itemId; }
    function onSelect(item) {
        var target=Model.find(id);
        if(item.getId()!=:cancel && target!=null) {
            var seconds=item.getId()==:week?604800:86400;
            if(item.getId()==:tomorrow) {
                var wanted=Model.dayKey(Time.now().value()+86400);
                var candidate=target["at"];
                var direction=Model.dayKey(candidate)>wanted?-1:1;
                while(Model.dayKey(candidate)!=wanted) { candidate+=direction*86400; }
                seconds=candidate-target["at"];
            }
            Model.change(target,"reschedule",(target["at"]+seconds).toString(),null); Sync.run(true);
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
