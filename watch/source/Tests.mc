using Toybox.Application.Storage;
using Toybox.Test;
using Toybox.Time;

(:test)
function persistedStatusAndFilters(logger) {
    var now=Time.now().value();
    var a=Model.task("a","Open assignment",now);
    var b=Model.task("b","Finished assignment",now-86400);
    b["status"]="done";
    var c=Model.task("c","Class meeting",now);
    c["type"]="event";
    Storage.setValue("test-fixtures",[a,b,c]);
    Model.items=Storage.getValue("test-fixtures");
    Test.assertEqual(Model.list(:open,null).size(),1);
    Test.assertEqual(Model.list(:overdue,null).size(),0);
    Test.assertEqual(Model.list(:done,null).size(),1);
    Test.assertEqual(Model.status(Model.items[1]),"Done");
    Model.apply(Model.items[0],{"action"=>"status","value"=>"doing"});
    Test.assertEqual(Model.list(:doing,null).size(),1);
    Model.apply(Model.items[0],{"action"=>"status","value"=>"done"});
    Test.assertEqual(Model.list(:open,null).size(),0);
    Model.apply(Model.items[0],{"action"=>"status","value"=>"todo"});
    Test.assertEqual(Model.list(:open,null).size(),1);
    Storage.deleteValue("test-fixtures");
    return true;
}

(:test)
function outboxKeepsUnacknowledgedEdits(logger) {
    Storage.setValue("queue",[{"id"=>"a"},{"id"=>"b"}]);
    Outbox.ack([{"id"=>"a","state"=>"applied"}]);
    Test.assertEqual(Model.queue().size(),1);
    Test.assertEqual(Model.queue()[0]["id"],"b");
    Storage.setValue("queue",[]);
    return true;
}

(:test)
function checklistPreservesOtherSteps(logger) {
    var a=Model.task("a","Checklist",Time.now().value());
    a["subtasks"]=[{"id"=>"one","done"=>false},{"id"=>"two","done"=>false}];
    Model.apply(a,{"action"=>"subtask","subtaskId"=>"one","value"=>"true"});
    Test.assert(a["subtasks"][0]["done"]);
    Test.assert(!a["subtasks"][1]["done"]);
    return true;
}
