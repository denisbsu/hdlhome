var fs = require('fs');
var PORT = 6000;
var HOST = '192.168.1.4';
var HOST = '0.0.0.0';

var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var mongoURL = 'mongodb://localhost:27017/homelog'


var MongoPromise = {

  connect: function(url) {
    if (this.connection != undefined) {
      this.disconnect();
    }
    var that = this;
    require('mongodb').MongoClient.connect(url, function(err, db){
      if (err) {
        console.log("Can not connect: ", err);
        return;
      }
      that.connection = db;
    });
  },
  disconnect: function() {
    if (this.connection === undefined) {
      console.log("not connected to database, can't disconnect");
      return;
    }
    this.connection.close();
    this.connection = undefined;
  },
  write: function(collection, data) {
    if (this.connection === undefined) {
      console.log("not connected to database, write lost");
      return;
    }
    var collectionObj = this.connection.collection(collection);
    collectionObj.insert([data], function (err, result) {
      if (err) {
        console.log(err);
      }
    });
  }
}

var listAllDevices = function() {
  HDLWrapper.sendCommand("Read Note", [255, 255]);
}


var readMac = function(dev) {
  HDLWrapper.sendCommand("Read MAC", [dev.subnet, dev.ip]);
}

var readChStatus = function(dev) {
  HDLWrapper.sendCommand("Read Status of all channels", [dev.subnet, dev.ip]);  
}

var readChNote = function(dev) {
  HDLWrapper.sendCommand("Read Ch Note", [dev.subnet, dev.ip, dev.ch]);  
}

var flipCh = function(dev) {
  var newValue = dev.level == 100 ? 0 : 100;
  HDLWrapper.sendCommand("Set Single Channel Status", [
    dev.subnet, 
    dev.ip, 
    dev.ch,
    newValue,
    0,
    0]);  
}

var mongoWrite = function(hdl, devType, string, raw) { 
    MongoPromise.write("logs_raw", {
      'source': hdl.source_subnet + ':' + hdl.source_ip,
      'destination': hdl.target_subnet + ':' + hdl.target_ip,
      'note': string,
      'raw': raw,
      'datetime': new Date()      
    });
  };

var makeCallback = function(message) {
  return function(hdl, devType, string, raw) {
    io.emit(message, {
      'ip': hdl.source_ip, 
      'subnet': hdl.source_subnet,
      'type': devType,
      'note': string,
      'raw': raw
    })}
}

var callbacks = {
//  0xe3e5 : function(hdl, devType, string) { console.log(hdl) },
  0x000F : makeCallback('dev found'),
  0xF004 : makeCallback('mac found'),
  0x0034 : makeCallback('ch found'),
  0x0032 : makeCallback('ch updated'),
  0xf00f : makeCallback('ch note'),
  0xe441 : makeCallback('report av'),
  0x1647 : makeCallback('broadcast sensors'),
  0xe3e5 : makeCallback('temp broadcast'),
  0x1949 : makeCallback('temp response'),
}

//var file = "normal.run";
//var file = "programming.ro.run";
/*
nextLine = function(list) {
  if (list.length == 0) return;
  if (list[0].length == 0) return;
  processPackage({})(Buffer(list[0], 'hex'));
  setTimeout(function(){nextLine(list.slice(1))}, 10);
}

var file = "all.run";
fs.readFile(file, function(err, data) {
  if (err) throw err;
  var lines = data.toString().split('\n');
  nextLine(lines);
  //lines.map(function(line){if (line.length) processPackage(Buffer(line, 'hex'))});
})
*/
//fs.writeFile("commands_text.json", JSON.stringify(commands_text));
//fs.writeFile("commands_args.json", JSON.stringify(commands_args));

//MongoPromise.connect(mongoURL);


var express = require('express');
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var HDLWrapper = require('./HDLWrapper');

HDLWrapper.connect(HOST, PORT, "192.168.1.250");

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

app.use(express.static('public'));

http.listen(3000, function(){
  console.log('HTTP listening on *:3000');
});



var bindSocketToDev = function(message, socket, call) {
  socket.on(message, call);
}

//"c0 a8 01 06 48444c4d495241434c45 aaaa 0b 0c fe fffe 000e ff ff aa53"
io.on('connection', function(socket){
  listAllDevices();
  bindSocketToDev('read mac', socket, readMac);
  bindSocketToDev('read ch status', socket, readChStatus);
  bindSocketToDev('flip ch', socket, flipCh);
  bindSocketToDev('read ch note', socket, readChNote);
});

HDLWrapper.addListener("message" , (msg) => {
    var callback = callbacks[msg.header.operation];
    if (callback) callback(msg.header, msg.body.deviceName, msg.body.callString, msg.body.raw.toString('hex'));
    //else io.emit('network activity', util.format("%s -> %s %s", hdl_source, hdl_target, callString));
});




