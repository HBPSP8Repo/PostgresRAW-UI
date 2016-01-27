var lastQuery = "";
var ongoing = false;
var queryResults = undefined;
var markers = [];

//function to be used when a new query changes in the editor
function post_query(editor, jsonEditor){
    var query = editor.getValue();

    // if something is still ongoing, return. We do not send another
    // request while the former one hasn't returned.
    if(ongoing == true) return;

    // from here on, the server is waiting for our query.

    // do not send if the query is empty.
    if (query == "") {
        // pretend we sent it and return.
        lastQuery = "";
        setIndicatorLabel("Ready");
        removeAllErrors(editor);
        return;
    }

    // otherwise send the query.
    setIndicatorLabel("Running...");
    console.log("sending query", query);
    // number of rows to get from the  query 
    var rows =1000;
    query_start( query, rows, {
            success: function(data){
                var token = data.token;
                if (data.hasMore){
                    set_get_next_data(token, jsonEditor, rows);
                    set_get_all(query, jsonEditor);
                }
                else{
                    $('#get_next').prop('disabled', true);
                    $('#get_all').prop('disabled', true);
                }
                ongoing = false;
                // what to do with these results
                if(editor.getValue() != lastQuery) {
                    // if the editor content changed to another query
                    // in the mean time resend
                    // instead of displaying results
                    post_query(editor, jsonEditor);
                }
                else {
                    console.log("data", data);
                    set_results(data.data, jsonEditor, {
                        executionTime: data.executionTime,
                        compilationTime: data.compilationTime
                    });
                }
            },
            error : function(request, status, error) {
                // see if this has to go inside the if block
                set_error();
                //if the query changed in the mean time resend
                if(editor.getValue() != lastQuery){
                    post_query(editor, jsonEditor);
                }
                else{
                    removeAllErrors(editor);
                    error = JSON.parse(error);
                    if (status == 400) {
                        handleQueryError(request, error, editor);
                    }
                    else if (status == 500){
                        handleServerError(request, error, editor);
                    }
                    else{
                        throw ("Unkown error status: " + status);
                        //append_error( "Internal error, exception type: " + error.exceptionType);
                    }
                }
            }
       }
    );
    ongoing = true;
    lastQuery = query;
}

function set_get_next_data(token, jsonEditor, rows){
    $('#get_next').prop('disabled', false);
    document.getElementById('get_next').onclick = function(){
        if(ongoing == true) return;
        setIndicatorLabel("Running...");
        ongoing = true;
        query_next(token, rows, {
            success: function(data){
                    console.log("data",data);
                    set_results(data.data, jsonEditor);
                    if(!data.hasMore){
                        $('#get_next').prop('disabled', true);
                        $('#get_all').prop('disabled', true);
                    }
                },
            error: function(request, status, error){
                    set_error();
                }
        });
   }
}


function set_get_all(query, jsonEditor){
    $('#get_all').prop('disabled', false);
    document.getElementById('get_all').onclick = function(){
        if(ongoing == true) return;
        $('#get_next').prop('disabled', true);
        $('#get_all').prop('disabled', true);
        setIndicatorLabel("Running...");
        ongoing = true;
        send_query(query, {
            success: function(data){
                    console.log("data", data);
                    set_results(data.output, jsonEditor)
                },
            error: function(request, status, error){
                    set_error();
                }
        });
   }
}
function set_results(results, jsonEditor, times){
    queryResults = results;
   //update plots and graphs
    setIndicatorLabel("Ready")
    jsonEditor.set(queryResults);
    redraw_graph( queryResults);
    ongoing = false;
    if (times){        
        $('#exec_time').empty();
        $('<li >Exec. time: '+ times.executionTime + ' (ms)</li>\
           <li >Comp. time: '+ times.compilationTime + ' (ms)</li>').appendTo('#exec_time');
   }
}

function set_error(){
    setIndicatorLabel("Error");
    ongoing = false;
    $('#get_all').prop('disabled', true);
    $('#get_next').prop('disabled', true);
}

//Will get the schemas and update the UI
function list_schemas(){
    get_schema_list(  {
        success: function(data) {
            $("#schemas").empty();
            var tree =[];
            function node_exists(name){
                for (n in tree){
                    if (name == tree[n].text) return true;
                }
                return false;
            }
            for(n in data.schemas){
                var node = {text : data.schemas[n] };
                //TODO: check for a better way to find out if it is an internal extent 
                tree.push(node);
            }
            $('#schema_tree').treeview({data: tree });
        },
        error : function(response, status, error) {
            console.log(response);
            append_error(response.responseText);
        }
     });
}


//Will handle internal errors (status 500 from scala server)
// for the time being just handling RuntimeException
function handleServerError(request, error, editor){
    if (error.exceptionType == "java.lang.RuntimeException"){
        // here tries to create the alternatives to regexes with escaped characters
        var create_alternatives = function(r){
            var alt = r.replace(/\\/g, "\\\\")
                    .replace(/\n/g, "\\n")
                    //.replace(/\b/g, "\\b")
                    .replace(/"/g, "\\\"")
                    .replace(/\t/g, "\\t")
                    .replace(/\r/g, "\\r");
            return[r, alt];
        };

        var matches = error.message.match(/regex\|\|\|\|((.|\n)*)\|\|\|\|(.*)/);
        if (!matches){
            throw("could not parse regex from error message: " + error.message);
        }
        // with the (.\n)*, for the multiline match creates a group, so group 2 is ignored
        console.log("parsed ", matches);
        var regex = matches[1];
        var msg = matches[3];
        var alts = create_alternatives (regex);

        console.log("searching for", alts);
        var lines = editor.getValue().split("\n");
        var errors = [];
        for (var n= 0 ; n < lines.length ; n++){
            for(var i=0 ; i < alts.length ; i ++){
                var column = lines[n].indexOf(alts[i]) + 1;
                if ( column > 0){
                    console.log("found in line", n, lines[n], alts[i]);
                    var marker = {
                        errorType : "RegexError",
                        positions: [
                            {
                                begin: {line: n +1, column: column},
                                end: { line: n +1, column: column + alts[i].length }
                            }
                        ],
                        message : msg
                    }
                    errors.push(marker);
                }
           }
        }
        addErrorMarkers(editor, errors);
    }
    else{
        console.log(error);
        throw ("Unknown error type" + error.exceptionType);
    }
}

//Will handle query errors (status 400 from scala server)
// and update the UI elements (ace editor etc)
function handleQueryError(request, error, editor){
    console.log("Got status 400");
    // will store all error markers here 
    var e = [];
    console.log("Error type", error.errorType);
    switch (error.errorType){
        case "SemanticErrors":
            var errorList = error.error.errors;
            for (var n in errorList){
                var marker = {
                    errorType : errorList[n].errorType,
                    positions :errorList[n].positions ,
                    message : errorList[n].message
                }
                e.push(marker);
            }
            break;
        case "ParserError":
            var lines = editor.getValue().split('\n');
            console.log("ParseError", pos);
            var pos = {
                begin : error.error.position.begin,
                end : {
                    line : lines.length,
                    column:lines[lines.length-1].length +1 
                }
            }
            var marker = {
                errorType : error.errorType,
                positions : [pos],
                message : error.error.message
            }
            e.push(marker);
            break;
        default:
            throw ("Unknown Error error type " + error.errorType);
    }
    addErrorMarkers(editor, e);
}

// will add a list of markers and annotations for errors in ACE editor
function addErrorMarkers(editor, errors){

    var annotations = [];
    for (var n in errors){
        for(i in errors[n].positions){
            var pos =errors[n].positions[i];
            console.log("pos", pos);
            addSquiglylines(editor, pos, errors[n].message, annotations)
        }
    }

    editor.session.setAnnotations( annotations );
}

// adds a squigly lines, from a position and a message,
// this is hacky, I tried to check in Ace editor but could not find, 
// TODO: check if there is a better way of doing this
function addSquiglylines(editor, pos, msg, annotations){

    var addmarker= function(p, type){
        if(pos.begin.line == p.end.line && 
                pos.begin.column == p.end.column){
            pos.end.column ++;
        }
        var Range = ace.require('ace/range').Range;
        var range = new Range(p.begin.line-1, p.begin.column-1,
                                p.end.line -1, p.end.column-1);

        var m1 = editor.session.addMarker(range, type, "text");
        markers.push(m1);
        var  a =  {
            row: pos.begin.line-1,
            column: 0,
            text: msg,
            type: "error" // also warning and information
        }
        annotations.push(a);
    };

    var mark = function(line, start, end){
        if(end==start) end++;
        for (var n = start ; n < end ; n++){
            addmarker({
                    begin:{line : line, column : n},
                    end:{line : line, column : n+1}
                },
                "queryError"
            );
        }
    };
    
    if (pos.begin.line == pos.end.line){
        mark(pos.begin.line, pos.begin.column, pos.end.column);
    }
    else{
        var lines = editor.getValue().split('\n');
        // first line marks till the end
        var text = lines[pos.begin.line];
        mark(pos.begin.line, pos.begin.column, text.length);
        for(var n = pos.begin.line ; n < pos.end.line-1 ; n++){
            mark(n, 1, lines[n].length+1);
        }
        mark(pos.end.line, 0, pos.end.column);
    }
    //addmarker(pos,  "errorHighlight");
}

// removes all errors and markers added by addErrorMarkers
function removeAllErrors(editor){
    for (n in markers){
        editor.session.removeMarker(markers[n]);
    }
    //checked tha API and could not find remove annotation function
    editor.session.setAnnotations( [] );
}

// sets the label on the top of the query
function setIndicatorLabel(label){
    $("#indicator").removeClass("label-success");
    $("#indicator").removeClass("label-danger");
    $("#indicator").removeClass("label-info");

    switch(label){
        case "Ready":
            $("#indicator").addClass("label-success");
            $("#indicator").text("Ready");
            break;
        case "Error":
            $("#indicator").addClass("label-danger");
            $("#indicator").text("Error");
            break;
        case "Running...":
            $("#indicator").addClass("label-info");
            $("#indicator").text("Running...");
            break;
        default:
            throw ("wrong indicator label");
    }
    
}

//helper function that transforms an object returned from the dropbox chooser
// to something that we can register in our server
function get_dropbox_options(selection){
    var option_list = [];
    for(n in selection){
        var options = {protocol : 'url'};
        // removes everything after the ?
        // and adds the dl=1 option
        options.url = selection[n].link.split('?')[0];
        options.url +='?dl=1'
        
        console.log(selection);
        options.filename = selection[n].name;
        var extension =selection[n].name.split('.').pop();
        options.name = selection[n].name.split('.')[0];
        //cleans the not permited characters 
        options.name = options.name.replace(/[ \.~-]/g,'_')
        switch(extension){
            case 'json':
            case 'csv' :
            case 'hjson':
                options.type = extension;
                break;
            default:
                options.type = 'text';
                //throw " unsuported file type " + extension ;
        }
        option_list.push(options);
    }
    return option_list;
}

var upload_alerts = {
        success: function(data) {
            console.log(data);
            if(data && data.name){
                append_alert('File ' + data.name  + ' registered');
            }
            else{
                append_alert('File registered');
            }
            // list the schemas again 
            list_schemas();
        },
        error : function(request, status, error) {
            console.log("error", request, status, error);
            var response = JSON.parse(request.responseText);
            append_error("Error registering file '" + response.exceptionType + "' : "+ response.message);
        }
     }

// will start the dropbox chooser and register files from dropbox
function add_from_dropbox(){
    console.log("adding from dropbox");
    var options = {
        // Required. Called when a user selects an item in the Chooser.
        success: function (files){
            var options = get_dropbox_options(files);
            var inputs = add_files_to_dialog(options);
            document.getElementById("register_button").onclick = function(){
                var ok = true;
                var files = [];
                for(n in options){
                    var f = options[n];
                    f.name = $("#"+inputs[n].name).val();
                    //if ( ! /[_a-zA-Z]\w*/.test(name)) ok = false;

                    /* checks if the name is ok*/
                    f.type = $("#"+inputs[n].type).val();
                    //if (f.type == null) ok = false;
                    files.push(f);
                }
                if(ok){
                    for (n in files){
                        console.log("registering file ", files[n]);
                        register_file(files[n], upload_alerts);
                    }
                    //closes the dialog
                    $("#register_dialog").modal('hide');
               }
                
            }
            $("#register_dialog").modal('show');
        },
        cancel: function() { },
        multiselect: true //selection of multiple files
    };
    Dropbox.choose(options);
}

// adds a dataset from a URL
function add_from_url(url, name, type) {
    var f = { "name": name, "filename": name + "." + type, "url": url, "type": type, "protocol": "url" };
    register_file(f, upload_alerts);
}

// function to download result from a query 
function downloadObj(obj, filename, format){ 
    //TODO: check if there are limits in the size of data for encodeURIComponent
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent( formatResults( obj, format));
    var dlElem = document.getElementById('downloadAnchorElem');
    dlElem.setAttribute("href", dataStr);
    dlElem.setAttribute("download", filename);
    dlElem.click();
}

//will add items to select name and file type for the files selected in the dialog
// returns an array of objects with the ids of the inputs added {name, type}
function add_files_to_dialog(files){
    
    $("#modal_body").empty();
    $('<label>Write here the name you\'d like to use</label>').appendTo("#modal_body");
    var inputs = [];
    for( n in files){
        var f = files[n];
        var id = f.filename.replace(/[ \.~-]/g,'_');
        var i = {name : 'n_'+id, type : 't_'+id };
        inputs.push(i);
        console.log('adding file', f);
        $('<div class="form-group">\
            <div class="input-append">\
                <div class="form-group has-feedback  has-success">\
                    <input type="text" class="form-control" id="' + i.name + '" placeholder="file name" style="float:left;width:80%;">\
                </div>\
                <div class="btn-group " style=style="float:right;">\
                    <select class="form-control" id="'+ i.type +'">\
                    <option value="csv">CSV</option>\
                    <option value="json">JSON</option>\
                    <option value="hjson">HJSON</option>\
                    <option value="text">TEXT</option>\
                    </select>\
                </div>\
            </div>\
        </div>').appendTo("#modal_body");

        var setStatus = function(obj, error){
            parent = $(obj).parent();
            parent.removeClass("has-success");
            parent.removeClass("has-error");
            if ( error){
                parent.addClass("has-error");
                $('<span class="glyphicon glyphicon-warning-sign form-control-feedback"></span>').appendTo(parent)
            }
            else{
                parent.addClass("has-success");
                $('<span class="glyphicon glyphicon-ok form-control-feedback"></span>').appendTo(parent);
            }
        }
        $("#"+i.name).val(f.name);
        $("#"+i.type).val(f.type);
   }

    // adds the button at the end
    $('<button type="submit" class="btn btn btn-success" id = "register_button">\
        <span class="glyphicon glyphicon-ok-sign"></span>  Go !</button>').appendTo("#modal_body");
    return inputs;
}

//function to append success message to the alert pane
function append_alert(msg){
    $('<div class="col-lg-12 alert alert-success alert-dismissable">'+
            '<button type="button" class="close" ' + 
                    'data-dismiss="alert" aria-hidden="true">' + 
                '&times;' + 
            '</button>' +  
            msg + 
         '</div>').appendTo("#alerts");

    $('.alert').stop().fadeOut(5000);
}

//function to append error message to the alert pane
function append_error(msg){
    $('<div class="col-lg-12 alert alert-danger">'+
            '<button type="button" class="close" ' + 
                    'data-dismiss="alert" aria-hidden="true">' + 
                '&times;' + 
            '</button>' +  
            msg + 
         '</div>').appendTo("#alerts");
}


function load_dataset(what) {
    var datasets = {
        "httplogs": {"url": "https://www.dropbox.com/s/mun7lpgk4jpdw9d/httplogs.csv?dl=1", "name":"httplogs", "type":"csv"},
        "log_example": {"url": "https://www.dropbox.com/s/29bzcqvfjiwhk14/log_example.log?dl=1", "name":"log_example", "type":"text"},
        "log_example2": {"url": "https://www.dropbox.com/s/i4b5hjmkf4f8g8o/log_example2.log?dl=1", "name":"log_example2", "type":"text"},
        "publications": {"url": "https://www.dropbox.com/s/77youjyiz9u0eh9/publications.json?dl=1", "name":"publications", "type":"json"},
        "authors": {"url": "https://www.dropbox.com/s/vvuvydjqb8rdhhr/authors.json?dl=1", "name": "authors", "type":"json"}
    };
    add_from_url(datasets[what].url, datasets[what].name, datasets[what].type);
}
