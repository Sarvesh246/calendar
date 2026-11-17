using Toybox.WatchUi;

class FieldMenu extends WatchUi.Menu2InputDelegate {
    var id;
    var action;
    function initialize(itemId,field) { Menu2InputDelegate.initialize(); id=itemId; action=field; }
    function onSelect(menuItem) {
        var item=Model.find(id);
        if(item!=null && Model.change(item,action,menuItem.getId(),null)) { Paint.buzz(); Sync.run(true); }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
class RenameText extends WatchUi.TextPickerDelegate {
    var id;
    function initialize(itemId) { TextPickerDelegate.initialize(); id=itemId; }
    function onTextEntered(text,changed) {
        var item=Model.find(id);
        if(item!=null && text.length()>0 && text.length()<=240 && Model.change(item,"rename",text,null)) { Paint.buzz(); Sync.run(true); }
        WatchUi.popView(WatchUi.SLIDE_DOWN); return true;
    }
    function onCancel() { WatchUi.popView(WatchUi.SLIDE_DOWN); return true; }
}
class SearchText extends WatchUi.TextPickerDelegate {
    function initialize() { TextPickerDelegate.initialize(); }
    function onTextEntered(text,changed) {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        var menu=new WatchUi.Menu2({:title=>"Search results"});
        var count=0;
        for(var i=0;i<Model.items.size();i++) {
            var item=Model.items[i];
            var haystack=(item["title"]+" "+item["class"]+" "+item["description"]).toLower();
            if(haystack.find(text.toLower())!=null) { Nav.add(menu,item["title"],Model.date(item),item["id"]); count++; }
        }
        if(count==0) { Nav.add(menu,"No matches","Search covers cached items",:empty); }
        Nav.push(menu,new ItemMenu()); return true;
    }
    function onCancel() { WatchUi.popView(WatchUi.SLIDE_DOWN); return true; }
}
