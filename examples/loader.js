#!/usr/bin/env node
/**
 * Implements a utility to load firmware into Control Solutions devices using
 * a MODBUS interface.
 *
 * Supports loading via serial port currently.
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

// Load the object that handles communication to the device
var Modbus = require('@csllc/cs-modbus');

// the instance of the modbus master
var master;

const BootloaderTarget = require('../lib/BootloaderTarget');
const Bootloader = require('..');

const APP_NAME = path.basename(__filename, '.js');

let masterConfig = {
  "transport": {
      "type": "rtu",
      "eofTimeout": 40,
      "connection": {
          "type": "serial",
      }
  },
  "suppressTransactionErrors": true,
  "retryOnException": false,
  "maxConcurrentRequests": 1,
  "defaultUnit": 1,
  "defaultMaxRetries": 0,
  "defaultTimeout": 500
};

// handy function to update a single line showing progress
function printProgress(progress){
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(progress.toFixed(0) + '%');
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

// Set up the bootloader config accordingly
let target = new BootloaderTarget.DefaultPic18Target();
let config = {
  target: target,
  space: 0
};


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

  // Make serial port instance available for the modbus master
  masterConfig.transport.connection.serialPort = port;

  createMaster();

  // port errors
  port.on('error', function( err ) {
    console.error( chalk.underline.bold( err.message ));
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
  });
}

function createMaster( ) {

  // Create the MODBUS master
  master = Modbus.createMaster( masterConfig );


  // Attach event handler for the port opening
  master.once( 'connected', function() {

    // Start communicating with the bootloader
    const bl = new Bootloader( master );

    // If verbose, catch events from the bootloader and display them
    if( args.v ) {
      // catch status message from bootloader for display
      bl.on('status', function( status ) {              
        console.log( status );
      });

      // Catch progress counter
      bl.on('progress', function( percent ){
        printProgress( percent );
      });

    }

    // start trying to load the file
    bl.start( filename, config )
    .then( function() {

      if( args.v ) {
        console.log( chalk.green('Success!'));
      }
      process.exit( 0 );
    })
    .catch( function( err ) {
      if( args.v ) {
        console.error( err.message );
      }
      process.exit( 1 );
    });

  });


  // Hook events for logging if verbose mode
  if( args.v ) {

    var connection = master.getConnection();

    connection.on('open', function(){
      console.log( '[connection#open  ]');
    });

    connection.on('close', function(){
      console.log('[connection#close]');
    });

    connection.on('error', function(err){
      console.log('Error: ', '[connection#error] ' + err.message);
    });

    connection.on('write', function(data){
      console.log('[TX] ', util.inspect( data ) );
    });

    connection.on('data', function(data){
      console.log('[RX] ', util.inspect(data ));
    });

    var transport = master.getTransport();

    // catch event when a transaction starts.  Hook the events for logging
    transport.on('request', function(transaction)
    {

      transaction.once('timeout', function()
      {
        console.log('[timeout]');
      });

      transaction.once('error', function(err)
      {
        console.log('[error] %s', err.message);
      });

      transaction.once('response', function(response)
      {
        if (response.isException())
        {
          console.log('[response] ', response.toString());
        }
        else
        {
          console.log(response.toString());
        }
      });

      transaction.once('complete', function(err, response)
      {
        if (err)
        {
          console.log('[complete] ', err.message);
        }
        else
        {
          console.log('[complete] %s', response);
        }
     
      });

      transaction.once('cancel', function()
      {
        console.log('[cancel]');
      });


      console.log( transaction.getRequest().toString());
    });

  }
}

