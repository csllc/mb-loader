#!/usr/bin/env node
/**
 * Implements a utility to load firmware into Phoenix devices using
 * a CANBUS interface.
 *
 * Supports loading via a CAN-USB-COM device currently.  This device appears as a serial port
 * and allows a connection to a CANBUS network
 *
 * In order to run this example you need
 * npm install chalk minimist can-usb-com  serialport
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
var CanbusPort = require('can-usb-com');

// Module which manages the serial port
var SerialPort = require('serialport');

// Load the object that handles communication to the device
//var Modbus = require('cs-modbus');
var Modbus = require('@csllc/cs-modbus');

// the instance of the modbus master
var master;

// our J1939 node ID
const MY_ID = 248;

// ID of device we are trying to program
const remoteId = 0x80;

const Bootloader = require('..');

const APP_NAME = path.basename(__filename, '.js');

let eeData = `
:10000000AA55AA55AA55AA55AA55AA55AA55AA55F8
:10001000AA55AA55AA55AA55AA55AA55AA55AA55E8
:10002000AA55AA55AA55AA55AA55AA55AA55AA55D8
:10003000AA55AA55AA55AA55AA55AA55AA55AA55C8
:10004000AA55AA55AA55AA55AA55AA55AA55AA55B8
:10005000AA55AA55AA55AA55AA55AA55AA55AA55A8
:10006000AA55AA55AA55AA55AA55AA55AA55AA5598
:10007000AA55AA55AA55AA55AA55AA55AA55AA5588
:10008000AA55AA55AA55AA55AA55AA55AA55AA5578
:10009000AA55AA55AA55AA55AA55AA55AA55AA5568
:1000A000AA55AA55AA55AA55AA55AA55AA55AA5558
:1000B000AA55AA55AA55AA55AA55AA55AA55AA5548
:1000C000AA55AA55AA55AA55AA55AA55AA55AA5538
:1000D000AA55AA55AA55AA55AA55AA55AA55AA5528
:1000E000AA55AA55AA55AA55AA55AA55AA55AA5518
:1000F000AA55AA55AA55AA55AA55AA55AA55AA5508
:10010000AA55AA55AA55AA55AA55AA55AA55AA55F7
:10011000AA55AA55AA55AA55AA55AA55AA55AA55E7
:10012000AA55AA55AA55AA55AA55AA55AA55AA55D7
:10013000AA55AA55AA55AA55AA55AA55AA55AA55C7
:10014000AA55AA55AA55AA55AA55AA55AA55AA55B7
:10015000AA55AA55AA55AA55AA55AA55AA55AA55A7
:10016000AA55AA55AA55AA55AA55AA55AA55AA5597
:10017000AA55AA55AA55AA55AA55AA55AA55AA5587
:10018000AA55AA55AA55AA55AA55AA55AA55AA5577
:10019000AA55AA55AA55AA55AA55AA55AA55AA5567
:1001A000AA55AA55AA55AA55AA55AA55AA55AA5557
:1001B000AA55AA55AA55AA55AA55AA55AA55AA5547
:1001C000AA55AA55AA55AA55AA55AA55AA55AA5537
:1001D000AA55AA55AA55AA55AA55AA55AA55AA5527
:1001E000AA55AA55AA55AA55AA55AA55AA55AA5517
:1001F000AA55AA55AA55AA55AA55AA55AA55AA5507
:00000001FF
`;

let ff = `:10000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00
:10001000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0
:10002000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE0
:10003000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFD0
:10004000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC0
:10005000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFB0
:10006000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA0
:10007000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF90
:10008000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF80
:10009000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF70
:1000A000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF60
:1000B000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF50
:1000C000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF40
:1000D000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF30
:1000E000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF20
:1000F000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF10
:10010000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
:10011000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEF
:10012000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDF
:10013000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFCF
:10014000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBF
:10015000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF
:10016000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF9F
:10017000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF8F
:10018000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7F
:10019000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF6F
:1001A000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5F
:1001B000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF4F
:1001C000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF3F
:1001D000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF2F
:1001E000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF1F
:1001F000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0F
:00000001FF
`;
let masterConfig = {
  "transport": {
      "type": "j1939",
      "connection": {
          "type": "generic",
      }
  },
  "suppressTransactionErrors": true,
  "retryOnException": false,
  "maxConcurrentRequests": 1,
  "defaultUnit": remoteId,
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

  console.info( APP_NAME + ' upgrade.hex COM1 500000 (load file at 500000 baud)\r');

  process.exit(0);
}

// Parse the arguments
let filename = args._[0] || 'Unknown.hex';
let portName = args._[1] || 'COM1';
let baud = args._[2] || 250000;

let options = {
  baudRate: 460800,
  autoOpen: false,
};




// Check for the list ports option
if( args.l ) {
  // Retrieve a list of all ports detected on the system
  SerialPort.list()
  .then( function( ports ) {

    if( ports ) {
      // ports is now an array of port descriptions.
      ports.forEach(function(port) {

        // print each port description
        console.log(port.path +
        ' : ' + port.pnpId + ' : ' + port.manufacturer );

      });
    }

    process.exit(0);

  })
  .catch( function (err ){
    console.error( err );
  });

}
else {

  // Use default settings (do not filter messages)
  let board = new CanbusPort({

    // bit rate on the CAN bus
    canRate: 250000,

    // typical CAN sample point
    samplePoint: 75,

    j1939: {
      address: MY_ID,
    },

  });

  masterConfig.transport.connection.device = board;

  createMaster();

  if( args.v ) {
    console.log( 'Opening ' + portName );
  }

  // Open the com port and configure...
  board.open( portName )

  .then( function() {

    if( args.v ) {
      console.log( 'Port Open' );
    }

  })
  .catch( function( err ) {
    // If anything goes wrong, report the error and exit
    console.error( err );
    board.close();
    process.exit(-1);
  });

}


function createMaster( ) {

  // Create the MODBUS master
  master = Modbus.createMaster( masterConfig );

  // Attach event handler for the port opening
  master.once( 'connected', function() {

    // Start communicating with the bootloader
    const bl = new Bootloader( master );

    // define how we interact with the target
    let target = new bl.BootloaderTarget.Target({
      
      name: 'Device',
      supportsPassThru: false,
      code: 'any',
      type: '',

      enquireTimeout: 100,
      selectTimeout: 500,
      eraseTimeout: 1000,
      dataTimeout: 2000,
      verifyTimeout: 1000,
      finishTimeout: 500,

      }, [
        new bl.BootloaderTarget.PIC24Application({
          hexBlock: 8*256,

          sendBlock: 8*192,

        }),
        new bl.BootloaderTarget.EEPROM({
          hexBlock: 256,
          sendBlock: 256,
          dataTimeout: 2000,
        }),

      ]
    );


    const { Readable } = require('stream');

    const dataStream = Readable.from( ff );

    // Set up the bootloader config accordingly
    let config = {
      target: target,
      space: 1
    };

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
    bl.start( dataStream, config )
//    bl.start( filename, config )
    .then( function() {

      if( args.v ) {
        console.log( chalk.green('Success!'));
      }
      process.exit( 0 );
    })
    .catch( function( err ) {

      if( args.v ) {
        console.error( err );
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

