#!/usr/bin/env node
/**
 * Implements a utility to load firmware into a device using the Tiny Bootloader
 *
 * Supports loading via serial port currently.  This actually doesn't use the 
 * MODBUS protocol at all - it was originally developed to unit test the 
 * Tiny Bootloader-via-modbus scenario.
 *
 * In order to run this example you need
 * npm install chalk minimist serialport
 *
 *
 */

// get application path
var path = require('path');

// misc utilities
var util = require('util');

// console text formatting
var chalk = require('chalk');

// command-line options will be available in the args variable
var args = require('minimist')(process.argv.slice(2));

// Module which manages the serial port
var SerialPort = require('serialport');

const IntelHex = require( '../lib/intelhex');

const APP_NAME = path.basename(__filename, '.js');


// handy function to update a single line showing progress
function printProgress(progress){
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(progress.toFixed(0) + '%');
}

function DumpTx( data ) {
  console.log( chalk.blue('('+ data.length+') '+ util.inspect( Buffer.from( data) ) ));
}

// If -h option, print help
if( args.h  ) {

  console.info( '\r------------------');
  console.info( 'Bootloader Utility\r');
  console.info( '\rCommand format:\r');
  console.info( APP_NAME +
    ' [-h -v] filename port baudrate\r');

  console.info( chalk.underline( '\rOptions\r'));
  console.info( '    -h           This help output\r');
  console.info( '    -v           Verbose output (for debugging)\r');

  console.info( chalk.underline( '\rResult\r'));
  console.info( 'Return value is 0 if successful\r');
  console.info( chalk.underline( 'Examples\r'));

  console.info( APP_NAME + ' upgrade.hex COM1 115200 (load file at 115200 baud)\r');

  process.exit(0);
}

// Parse the arguments
let filename = args._[0] || 'Unknown.hex';
let portName = args._[1] || 'COM1';
let baud = args._[2] || 115200;

let options = {
  baudRate: baud,
  autoOpen: false,
};

let timer = process.hrtime();

function waitFor81( port ) {
  return new Promise( function( resolve, reject ){


  function ondata( data ) {

    if( data[ data.length-1 ] === 0xB1 ) {
      port.removeListener('data', ondata );
      resolve();
    }
  }

  port.on( 'data', ondata );

  });
}

// wait till 'num' bytes received on port
function portRead( port, num ) {

  return new Promise( function( resolve ){
    let result = [];

    function ondata( data ) {
      result.push( ...data );
      //console.log('portread ', data, result );
      if( result.length >= num ) {

         port.removeListener('data', ondata );
        resolve( result );
      }
    }

    port.on( 'data', ondata );
  });

}



function brainRead8( port, opcode, addr ) {

  return new Promise( function( resolve, reject ){

    waitFor81( port )
    .then( function(){

      DumpTx( [opcode, addr ] );
      port.write( [opcode, addr ] );

      return portRead( port, 2 );

    })
    .then( function( data ){
      //console.log( 'result:', addr, data  );
      if( ((addr + data[0]) & 0xFF) === data[1]) {
        resolve( data[0] );
      }
      else {
        //resolve( data[0] );
        reject( new Error('Bad response to ' + opcode.toString(16) + ' ' + addr.toString(16) + ' ' + data[0]+ ' ' + data[1] ));
      }
    })
    .catch( function(err) {
      reject(err);
    });

  });
}


function brainCommand( port, buf, cks ) {

  return new Promise( function( resolve, reject ){


  function ondata( data ) {
    if( data[ data.length-1 ] === 0xB1 ) {
      
      DumpTx( buf );
      port.write( buf );
      
      port.once( 'data', function( byte ){

        if( byte[0] === buf[buf.length-1] ) {
          port.removeListener('data', ondata );
         resolve();
        }

      });

    }
  }

  port.on( 'data', ondata );

  });
}

function enterBootloader( port ) {

  return new Promise( function( resolve, reject ) {
    port.flush();

    port.once( 'data', function( data ){
    port.once( 'data', function( data ){

      brainCommand( port, [0x06, 0xE0, 0xDE , 0xBE])
      .then( function() {
        return brainCommand( port, [0x06, 0xE0, 0xAD , 0x8D] );
      })
      .then( function() {
        resolve();
      });

    });


    });
  });

}

function connectToDevice( port ) {
  return new Promise( function( resolve ){

    let timer;

    function requestId() {
      DumpTx( [ 0xC1 ]);
      port.write( [ 0xC1 ] );
    }

    function onData( data ) {
      //console.log( 'connect:data:', data );
      
      if( data[0] === 0x2C ) {
        clearInterval( timer );
        port.removeListener('data', onData );
        
        // delay to allow the 'B' character to go by
        setTimeout( resolve, 100 );
        
      }
    }

    port.on('data', onData );

    timer = setInterval( requestId, 100 );

  });

}


function loadFile( filename ) {
  return new Promise( function( resolve, reject ){
    let parser = new IntelHex();

    parser.loadFile( filename, 64 )
    .then( function( blocks ){
      return resolve( blocks );
    })
    .catch( function( err ){
      reject( err );
    });
    
  });
}

function sendBlock( port, block, index ) {

  return new Promise( function( resolve, reject ) {
    let cks = 0;
    let address = (index * block.length)/2;

    // force for debugging
    //address = (0x7340/2);

    // not eeprom, cfg, etc
    // if( address > (0x3FFF-192) || address < 0x40) {
    //   return resolve();
    // }

    cks += ((address /256) & 0xFF);
    cks += address & 0xFF;
    cks += 64;

    for( let i = 0; i < 64; i++ ) {
      cks += block[i];
    }
//    let tx = [(address /256) & 0xFF, address & 0xFF, 64, ... block, cks & 0xFF ];
    let tx = [(address /256) & 0xFF, address & 0xFF, 64 ];

    var arr = [Buffer.from(tx), Buffer.from(block), Buffer.from( [cks ])];


    let packet = Buffer.concat( arr );

   // port.write( packet );

     port.write( tx );
     port.write( block );
     port.write( [cks] );

    DumpTx( packet);

    //console.log( 'WR: ' + address.toString(16) );

    port.flush();
    port.once('data', function( data ){
      //console.log( 'bl resp: ', data );
      if( data[0] === 0x42 ) {
         resolve();
       }
       else{

         console.log( 'retrying ', index );
         sendBlock( port, block, index )
         .then( function() {
           resolve();
         })
         .catch( function(){

           reject('Send block failed ' + address + ' ' + data[0]);

         });
       }
    });
  });
}

function sendFile( port, blocks ) {

  let todo = [];


  blocks.forEach( function( block, index ){

    todo.push( sendBlock.bind(null, port, block, index ) );

  });

  return todo.reduce((promiseChain, currentTask) => {
      return promiseChain.then(chainResults =>
          currentTask().then(currentResult =>
              [ ...chainResults, currentResult ]
          )
      );
  }, Promise.resolve([])).then(arrayOfResults => {
    // Do something with all results

    console.log( "Complete!");
  })
  .catch( function (err ){
    console.log( err );
    process.exit(1);
  });

}

function readEEprom( port ) {

 let todo = [];

 let i;

 for( i = 0; i < 256; i++ ) {

    todo.push( brainRead8.bind(null, port, 0xA0, i  ) );

  }
  //console.log( 'reading eeprom');

  return todo.reduce((promiseChain, currentTask) => {
      return promiseChain.then(chainResults =>
          currentTask().then(currentResult =>
              [ ...chainResults, currentResult ]
          )
      );
  }, Promise.resolve([])).then(arrayOfResults => {
    // Do something with all results

    console.log( "Complete!", arrayOfResults );
  })
  .catch( function (err ){
    console.log( err );
    process.exit(1);
  });
}


// Check for the list ports option
if( args.l ) {
  // Retrieve a list of all ports detected on the system
  SerialPort.list(function (err, ports) {

    if( err ) {
      console.error( err );
    }

    if( ports ) {
      // ports is now an array of port descriptions.
      ports.forEach(function(port) {

        // print each port description
        console.log(port.comName +
        ' : ' + port.pnpId + ' : ' + port.manufacturer );

      });
    }

    process.exit(0);

  });

}
else {

  let port;

  // Open the serial port we are going to use
  port = new SerialPort(
    portName,
    options);

  // port errors
  port.on('error', function( err ) {
    console.error( chalk.underline.bold( err.message ));
  });

  // debug output
  port.on('data', function( data ) {
    let elapsed = process.hrtime( timer );
    let ms = (elapsed[0]*1000 + (elapsed[1]/1000000)).toFixed(2);

    console.log( chalk.green('[' + ms + '] ' + util.inspect(data) ));
  });

  // Open the port
  // the 'open' event is triggered when complete
  if( args.v ) {
    console.log( 'Opening ' + portName );
  }

  port.open(function(err) {
    if( err ) {
      console.log(err);
      process.exit(1);
    }
    else {
      // serial port open - try to connect to device

      //readEEprom( port )
      Promise.resolve()
      .then( function() { 
        return enterBootloader( port ); 
      })
      .then( function() { 
        return connectToDevice( port ) ;
      })
      .then( function() { 
        return loadFile( filename ) ;
      })
      .then( function( blocks ) { 
        return sendFile( port, blocks );
      })
      .then( function( blocks ) { 
        //return readEEprom( port );
      })
      .then( function() { 
        console.log( chalk.green( 'Success!'));
        process.exit(0);
      })
      .catch( function( err ){
        console.log(err);
        process.exit(1);
      });
    }
  });
}


