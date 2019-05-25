/**
 * Implements the interface to the device bootloader 
 * 
 * This class is instantiated with a 'master' reference, which is a MODBUS master
 * object used to communicate with the target device.  
 * 
 * The Master/port should already be open and ready for communication before calling
 * the start() method.
 * 
 * Once communication is established, the supplied HEX file is parsed and 
 * marshalled into the device.  Hooks are used for manipulating the hex data into
 * the correct format/block size before loading.
 * 
 * This class emits events to indicate progress and status.
 * 
 * Methods are generally Promise-based, and will resolve when the operation
 * is completed.
 *    
 */

const EventEmitter = require('events').EventEmitter;

const IntelHex = require('./lib/intelhex');

// Bootloader OP codes (for communicating with embedded bootloader)

/**
 * OP Codes for Bootloader messaging with Host
 */
const BL_OP_ENQUIRE =0xF0;
const BL_OP_PASSTHRU_ON = 0xF1;
const BL_OP_PASSTHRU_OFF = 0xF2;
const BL_OP_SELECT =0xF3;

const BL_OP_ERASE =0xF8;
const BL_OP_DATA =0xF9;
const BL_OP_VERIFY =0xFA;
const BL_OP_RESET =0xFB;
const BL_OP_ERASE_ALL = 0xFC;
const BL_OP_FINISH = 0xFD;

const BL_OP_ACK =0x00;
const BL_OP_NACK =0xFF;

/**
 * The processor type (low nibble/4 bits max)
 */
const BL_PROC_PIC16 =0x00;
const BL_PROC_PIC18 =0x01;
const BL_PROC_PIC24 =0x02;

/**
 * The platform (high nibble/4 bits max)
 */
const BL_PLAT_CS1435 =0x00;
const BL_PLAT_GENERIC =0x20;


/**
 * Defines the class exported from this module
 */
module.exports = class ModbusBootloader extends EventEmitter {

  constructor( master ) {

    super();

    let me = this;
    
    // expose this class definition to upper level application
    me.BootloaderTarget = require('./lib/BootloaderTarget.js');

    // Stores data parsed from the hex file
    me.flashBlocks = [];

    // Keep a reference to the communication port we will use
    me.master = master;

    // the selected product and memory space we are working on
    me.target = null;
    me.space = null;

    // the block size of the currently selected memory space
    me.blockSize = 0;

    me.inPassThru = false;
  }
    
  /**
   * Issue a promisified MODBUS command
   *
   * @param {number}   op       The operation
   * @param {Buffer}   data     The data
   * @param {object}   options  The options
   * @param {number} [options.unit]
   * @param {number} [options.interval]
   * @param {number} [options.timeout]
   * @param {number} [options.maxRetries]
   * @return {Promise}  resolves when the command is completed
   */
  command( op, data, options ) {

    let me = this;

    if( data === null ) {
      data = [];
    }

    if( !Array.isArray( data ) ) {
      options = data;
      data = [];
    }
    
    options = options || {};

    return new Promise( function( resolve, reject ){

      options.onResponse = function( response ) {
        resolve( response.values );
      };
      options.onComplete = function( err ) {
        //console.log( this );
        if( err && !this.shouldRetry() ) {
          reject( err );
        }
      };

      me.master.command( op, Buffer.from(data), options );
    });
  }

  /**
   * Attempts to connect to the target device
   *
   * Resolves if compatible target is detected. Rejects otherwise
   * 
   * @return     Promise  
   */
  connectToTarget() {
    let me = this;

    return me.command( BL_OP_ENQUIRE, null, { timeout: 100, maxRetries: 300 })
    .then( function( response ) {
      

      // Response consists of
      // product code, versionMajor, versionMinor, numberOfSpaces
      me.blVersion = response[1] + '.' + response[2];

      // check for compatible bootloader version
      if( response[1] !== 3 && response[1] !== 2 ) {
         throw new Error( 'Unsupported bootloader version (' + me.blVersion + ')');
      }

      me.emit('status', 'Product Code: ' + response[0] );
      me.emit('status',  'Bootloader Version: ' + me.blVersion );

      // check the connected device is compatible with what we are trying to load
      //let check = me.target.isCompatible( response );
      let check = true;

      if( true !== check ) {
        throw new Error( check );
      }
    });
  }
 

  /**
   * Executes the programming operation
   * 
   * Establishes communication, parses the file, loads and verifies it
   *
   * @param      string   file     The file
   * @param      object   options  The options
   * @return     {Promise}  Resolves when operation is complete
   */
  start( file, config ) {

    let me = this;
    
    // what we are looking to program
    me.target = config.target;
    me.space = config.target.spaces[ config.space ];
    me.inPassThru = false;

    return new Promise( function( resolve, reject ) {
        
        // for keeping track of elapsed time
        let timer;
        let computedCrc;

        me.emit('status', 'Checking Communication');
        

        me.connectToTarget()
        .then( function( response ) {
          
          me.emit('status', 'Connected');
          me.emit('status', 'Selecting Memory');
          return me.command( BL_OP_SELECT, [config.space] );

        })
        .then( function( response ) {

          me.blockSize = response[0]*256 + response[1];
          me.appStart = (response[2]*0x1000000 + response[3]*0x10000 + response[4]*0x100 + response[5]);
          me.appEnd = (response[6]*0x1000000 + response[7]*0x10000 + response[8]*0x100 + response[9]);

          me.emit('status', 'Block Size: ' +  me.blockSize );
          me.emit('status', 'App Start: ' + me.appStart.toString(16)  );
          me.emit('status', 'App End: ' + me.appEnd.toString(16)  );

          // Read and check the HEX file
          me.emit('status', 'Loading File');

          return me.importFile( file );
        })
        .then( function() {

            // import was successful (otherwise an exception would
            // have been thrown and we wouldn't be here.)

            // send erase command
            me.emit('status', 'Erasing' );

            timer = process.hrtime();

            let action = me.command( BL_OP_ERASE, {timeout: me.space.eraseTimeout } );

            // determine the CRC of the entire application space
            computedCrc = me.space.checksum( me.appStart, me.appEnd, me.blockSize, me.flashBlocks );
            
            return action;

        })
        .then( function( response ) {
          
          if( BL_OP_ACK === response[0] ) {

            let elapsed = process.hrtime( timer );
            let seconds = (elapsed[0] + (elapsed[1]/1000000000)).toFixed(2);

            me.emit('status', 'Erase Complete (' + seconds + ' sec)');

            // Send the data!
            me.emit('status', 'Sending...');
            timer = process.hrtime();

            return me.sendBlocks();
          }
          else {
            throw new Error( 'Erase command was rejected by the device');
          }
        })
        .then( function() {

          let elapsed = process.hrtime( timer );
          let seconds = (elapsed[0] + (elapsed[1]/1000000000)).toFixed(2);

          me.emit('status', 'Programming Complete (' + seconds + ' sec)' );

          me.emit('status', 'Validating..');

          timer = process.hrtime()
          
          // End of transmission; request checksum
          let action = me.command( BL_OP_VERIFY, { timeout: me.space.verifyTimeout } );

          return action;
        })
        .then( function( response ) {

          let checksum = (response[0] << 8) + response[1];

          let elapsed = process.hrtime( timer );
          let seconds = (elapsed[0] + (elapsed[1]/1000000000)).toFixed(2);
          
          me.emit('status', 'Checksum: ' + checksum.toString(16) + ' (' + seconds + ' sec)');

          if( computedCrc !== checksum ) {
            throw new Error( 'Incorrect Checksum: Received ' + checksum.toString(16) + ' but wanted ' + computedCrc.toString(16));
          }
          return me.command( BL_OP_FINISH, { timeout: me.space.finishTimeout } );
        })
        .then( function( response ) {
          if( BL_OP_ACK === response[0] ) {

           // reset the processor
           //me.emit('status', 'Resetting');
           //me.port.write( [BL_OP_RESET] );

            resolve();
          }
          else {
            throw new Error('FINISH Command failed');
          }

          
        })
        .catch( function(err) {
          reject( err );
        })
        .catch( function(err) {
          reject( err );
        });

    });

  }

  // check to make sure the loaded image is compatible with our device
  validateHexFile( blocks ) {
    return true;
  }

  /**
   * Builds a bootloader byte stream for a single data block and 
   * returns a promise that resolves when it has been sent and acked.
   *
   * @param      {<type>}  index   The index
   * @param      {<type>}  block   The block
   * @return     Promise  Resolves when the block is sent and acknowledged
   */
  sendAppBlock( index, block ) {

    let me = this;

    return me.command( BL_OP_DATA, me.space.sendFilter( index, block ), {timeout: me.space.dataTimeout,  maxRetries: 3 } )
    .then( function( response ) {
      if( response[0] !== BL_OP_ACK ) {
        throw new Error('Unexpected response while writing data: ' + response[0] );
      }
      else {
        me.blocksCompleted++;
        me.emit( 'progress', 100 * (me.blocksCompleted/me.totalBlocks ) );

      }
    });
  }

  /**
   * Reads the specified hex file and parses it into binary blocks
   *
   * @param      string  filename  The filename
   * @return     Promise  resolves when the file has been parsed
   */
  importFile( filename ) {

    let me = this;

    let file = new IntelHex();

    // load file into blocks according to desired block size
    return file.loadFile( filename, me.space.hexBlock )
    .then( function( blocks ) {

      if( 'function' === typeof( me.space.loadFilter ) ) {
        me.space.loadFilter( blocks );
      }

      if( me.validateHexFile( blocks )) {
        me.flashBlocks = blocks;
      }
      else {
        throw new Error( 'Hex file is not compatible with this device');
      }
    });
  }

  /**
   * Builds an array of DATA commands to send to the device
   *
   * @return     Promise  Resolves when all blocks have been sent
   */
  sendBlocks() {

    let me = this;
    let space = me.space;

    let todo = [];

    me.totalBlocks = 0;
    me.blocksCompleted = 0;
               
    // for each block we have, create a Promise to send it.  Put
    // all the promises in the array.
    me.flashBlocks.forEach( function( block, index ) {

      let start = index * space.hexBlock / space.addressing;
      let end = ((index+1) * space.hexBlock / space.addressing) - space.addressing;
      //console.log( 'block', index, start.toString(16), end.toString(16));

      if( start >= me.appStart && end <= me.appEnd  ) {
        if( !space.blockIsEmpty( block )) {
          me.totalBlocks++; 
          todo.push( me.sendAppBlock( index, block ));
        }
        else {
          //console.log( 'Skipping empty block at ',start.toString(16));
        }
      }
      else {
        //me.emit('status', 'Ignoring out-of-range data at ' + start.toString(16));
      }
    });

    //console.log( 'block checksum: ', me.blockChecksum);

    // Return a promise that resolves when all Promises in the array are completed.
    return Promise.all( todo );
  }


};