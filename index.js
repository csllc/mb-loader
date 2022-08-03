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
const BL_OP_ENQUIRE = 0xF0;
const BL_OP_PASSTHRU_ON = 0xF1;
const BL_OP_PASSTHRU_OFF = 0xF2;
const BL_OP_SELECT = 0xF3;

const BL_OP_ERASE = 0xF8;
const BL_OP_DATA = 0xF9;
const BL_OP_VERIFY = 0xFA;
const BL_OP_RESET = 0xFB;
const BL_OP_ERASE_ALL = 0xFC;
const BL_OP_FINISH = 0xFD;

const BL_OP_ACK = 0x00;
const BL_OP_NACK = 0xFF;

/**
 * The processor type (low nibble/4 bits max)
 */
const BL_PROC_PIC16 = 0x00;
const BL_PROC_PIC18 = 0x01;
const BL_PROC_PIC24 = 0x02;

/**
 * The platform (high nibble/4 bits max)
 */
const BL_PLAT_CS1435 = 0x00;
const BL_PLAT_GENERIC = 0x20;


/**
 * Defines the class exported from this module
 */
module.exports = class ModbusBootloader extends EventEmitter {

  constructor(master, options) {

    super();

    let me = this;

    // expose this class definition to upper level application
    me.BootloaderTarget = require('./lib/BootloaderTarget.js');

    // expose this class definition to upper level application
    me.Hex = require('./lib/intelhex.js');

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

    // the bootloader version of the target device
    me.targetVersion = [0, 0];
    me.blVersion = '';  // the string version
    me.blScalarVersion = 0;  // a scalar version that facilitates simple >,< comparison

    // a list of all our in-progress modbus transactions (Transaction objects)
    me.transactions = [];

    // the CRC we calculate, for the purposes of matching with the bootloader's
    // calculation
    me.computedCrc = null;

    // are we in the process of aborting an unfinished load?
    me.aborting = false;

    // Are we in the process of loading target?
    me.inProgress = false;

    me.log = options.logger || { info: function(){}, error: function(){}, silly:function(){}};
  }

  // access state variable
  isAborting() {
    return this.aborting;
  }

  // access state variable
  isInProgress() {
    return this.inProgress;
  }

  // remove the transaction from our list of active transactions
  removeTransaction(transaction) {

    let index = this.transactions.indexOf(transaction);
    //this.log.silly('removeTransaction', index);
    if(index > -1) {
      this.transactions.splice(index, 1);
    }
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
  command(op, data, options) {

    let me = this;

    if(data === null) {
      data = [];
    }

    if(!Array.isArray(data)) {
      options = data;
      data = [];
    }

    options = options || {};

    // the ID of the device we are sending to.  Undefined
    // means the modbus master will use its default.
    options.unit = options.unit || me.unit || undefined;

    return new Promise(function(resolve, reject) {

      // options.onResponse = function(response) {
      //   me.removeTransaction(this);
      //   resolve(response.values);
      // };
      // options.onComplete = function(err) {
      //   //console.log('oncomplete', this, this.shouldRetry() );
      //   if(err && !this.shouldRetry()) {
      //     me.removeTransaction(this);
      //     reject(err);
      //   }
      // };

      options.onDone = function(err, response) {
        //console.log('onDone', err, response);
        me.removeTransaction(this);
        if(err) {
          reject(err);
        } else if(response) {
          resolve(response.values);
        } else {
          reject(new Error('Invalid command response'));
        }
      };

      //options.onCancel = function() {
        //me.log.info( 'MB-LOADER CANCEL');

      //};

      // If user has commanded an abort, don't send any commands
      if(me.aborting) {
        reject('Aborted by user');
      }
      else {
        // queue the command and save the transaction in case we need it
        // later (for instance to cancel)
      me.transactions.push(me.master.command(op, Buffer.from(data), options));

    }

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

    return me.command(BL_OP_ENQUIRE, null, { timeout: me.target.target.enquireTimeout, maxRetries: me.target.target.enquireRetries })
    .then(function(response) {


      if(response.length >= 4) {
        // Response consists of
        // product code, versionMajor, versionMinor, numberOfSpaces, max buffer(Msb,LSB)

        // save version for later use
        me.blVersion = response[1] + '.' + response[2];
        me.blScalarVersion = response[1]*256  + response[2];
        me.targetVersion = [response[1], response[2]];

        me.numberOfSpaces = response[3];
        if(response.length > 5) {
          me.maxBuffer = response[4] * 256 + response[5];
        } else {
          me.maxBuffer = 0;
        }

        // check for compatible bootloader version
        if([4, 3, 2].indexOf(response[1]) === -1) {
          throw new Error('Unsupported bootloader version (' + me.blVersion + ')');
        }

        me.emit('status', 'Product Code: ' + response[0]);
        me.emit('status', 'Bootloader Version: ' + me.blVersion);
        me.emit('status', 'Max Buffer: ' + me.maxBuffer);

        // check the connected device is compatible with what we are trying to load
        //let check = me.target.isCompatible( response );
        let check = true;

        if(true !== check) {
          throw new Error(check);
        }
      } else {

        // we got an invalid response back. this could be incorrect wiring
        // (loopback) or some other strange condition.  Try to ignore it
        //return me.connectToTarget();
        // Glase 2022-08-01 I don't think just trying again infinitely is the
        // right thing to do here.  It seems like throwing would be better,
        // even though it means the user will see an error.  A scenario is that
        // the user stopped and restarted the bootload operation quickly, and
        // the embedded side was still doing something.
        throw new Error('Invalid Response to ENQ');
      }
    })
    .catch(function(err) {
      if(err.name === 'ResponseTimeoutError') {
        throw new Error('No Response from Device');
      } else {
        throw err;
      }
    });
  }


  /**
   * Executes the programming operation
   *
   * Establishes communication, parses the file, loads and verifies it
   *
   * @param      string|function   file     The file to be programmed
   * @param      object   options  The options
   * @return     {Promise}  Resolves when operation is complete
   */
  start(file, config) {

    let me = this;

    // what we are looking to program
    me.target = config.target;
    me.space = config.target.spaces[config.space];
    me.inPassThru = false;
    me.aborting = false;
    me.transactions = [];

    // save, if set in config
    me.unit = config.unit;

    // default this for backward compatibility
    me.space.enquireRetries = me.space.enquireRetries || 100;

    return new Promise(function(resolve, reject) {

      me.inProgress = true;

      // for keeping track of elapsed time
      let timer;

      me.emit('status', 'Checking Communication');

      me.connectToTarget()
      .then(function(response) {
        if(me.space.selectDelay) {
          me.emit('status', 'Waiting for Reset');
          return new Promise((resolve, reject) => {
            setTimeout(() => { resolve(response); }, me.space.selectDelay);
          });
        }
      })
      .then(function(response) {
        me.emit('status', 'Connected');
        me.emit('status', 'Selecting Memory');
        return me.command(BL_OP_SELECT, [config.space]);
      })
      .then(function(response) {

        if(response.length > 5) {
          // version 4 uses a differently formatted message
          if(me.targetVersion[0] < 4) {
            me.blockSize = response[0] * 256 + response[1];
            me.appStart = (response[2] * 0x1000000 + response[3] * 0x10000 + response[4] * 0x100 + response[5]);
            me.appEnd = (response[6] * 0x1000000 + response[7] * 0x10000 + response[8] * 0x100 + response[9]);
          } else {
            me.blockSize = response[0] * 256 + response[1];
            let startBlock = response[2] * 0x100 + response[3];
            let endBlock = response[4] * 0x100 + response[5];

            me.appStart = startBlock * me.blockSize;
            me.appEnd = endBlock * me.blockSize;
          }

          me.emit('status', 'Min Block Size: ' + me.blockSize);
          me.emit('status', 'App Start: ' + me.appStart.toString(16));
          me.emit('status', 'App End: ' + me.appEnd.toString(16));

          return me.importFile(file);
        } else {
          throw (new Error('Invalid response to Select'));
        }
      })
      .then(function() {

        // import was successful (otherwise an exception would
        // have been thrown and we wouldn't be here.)

        // send erase command
        me.emit('status', 'Erasing');

        timer = process.hrtime();

        let action = me.command(BL_OP_ERASE, { timeout: me.space.eraseTimeout });

        return action;

      })
      .then(function(response) {

        if(BL_OP_ACK === response[0]) {

          let elapsed = process.hrtime(timer);
          let seconds = (elapsed[0] + (elapsed[1] / 1000000000)).toFixed(2);

          me.emit('status', 'Erase Complete (' + seconds + ' sec)');

          // Send the data!
          me.emit('status', 'Sending...');
          timer = process.hrtime();

          return me.sendBlocks();
        } else {
          throw new Error('Erase command was rejected by the device');
        }
      })
      .then(function() {

        let elapsed = process.hrtime(timer);
        let seconds = (elapsed[0] + (elapsed[1] / 1000000000)).toFixed(2);

        me.emit('status', 'Programming Complete (' + seconds + ' sec)');

        me.emit('status', 'Validating..');

        timer = process.hrtime();

        // End of transmission; request checksum
        let action = me.command(BL_OP_VERIFY, { timeout: me.space.verifyTimeout });

        return action;
      })
      .then(function(response) {

        let checksum = (response[0] << 8) + response[1];

        let elapsed = process.hrtime(timer);
        let seconds = (elapsed[0] + (elapsed[1] / 1000000000)).toFixed(2);

        me.emit('status', 'Checksum: ' + checksum.toString(16) + ' (' + seconds + ' sec)');

        if(me.computedCrc !== checksum) {
          throw new Error('Incorrect Checksum: Received ' + checksum.toString(16) + ' but wanted ' + me.computedCrc.toString(16));
        }
        return me.command(BL_OP_FINISH, { timeout: me.space.finishTimeout });
      })
      .then(function(response) {
        if(BL_OP_ACK === response[0]) {

          // reset the processor
          //me.emit('status', 'Resetting');
          //me.port.write( [BL_OP_RESET] );

          resolve();
        } else {
          throw new Error('FINISH Command failed');
        }


      })
      .catch(function(err) {
        // cancel any other transactions that are in progress
        me.abort();
        //console.log('mb-loader', err);
        reject(err);
      })
      .finally(function() {
        me.inProgress = false;
        //console.log('mb-loader::start finished');
      });

    });

  }

  // cancel bootloader
  abort() {
    let me = this;

    if( !me.aborting ) {
    me.aborting = true;

    me.log.info( 'MB_LOADER aborting ' + me.transactions.length );
    if(me.transactions.length > 0) {

      for(let i = me.transactions.length - 1; i >= 0; i--) {

        me.transactions[i].cancel();

      }

      //me.transactions = [];

    }
      me.emit('status', 'Aborted');
    }
  }


  // check to make sure the loaded image is compatible with our device
  validateHexFile(blocks) {
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
  sendAppBlock(index, block) {

    let me = this;

    // console.log('Send Block ' + index);

    return me.command(BL_OP_DATA, block, { timeout: me.space.dataTimeout, maxRetries: me.space.dataRetries })
    .then(function(response) {
      if(response[0] !== BL_OP_ACK) {
        throw new Error('Unexpected response while writing data: ' + response[0]);
      } else {

        // bytes 2 and 3 of the block are the address of the block.
        // if the bootloader returned the address in its response, make sure
        // it is the 'ACK' for the block we sent.  Otherwise we have gotten
        // out of sync with the embedded side
        if( me.blScalarVersion >= 0x0401 ) {
          console.log('Block ' + me.blocksCompleted + ' complete', block, response[3],response[4]);

          if( block[2] !== response[3] || block[3] !== response[4] ) {
            log.error('BLOCK OUT OF SEQUENCE');
            throw new Error('Incorrect Block Acknowledgement');
          }
        }

        me.blocksCompleted++;
        me.emit('progress', 100 * (me.blocksCompleted / me.totalBlocks));

      }
    })
    .catch(function(err) {
      throw err;
    });
  }

  /**
   * Reads the specified hex file and parses it into binary blocks
   *
   * @param      string  filename  The filename
   * @return     Promise  resolves when the file has been parsed
   */
  importFile(file) {

    let me = this;
    let loader;

    let hex = new IntelHex();
    let space = me.space;

    const { Readable } = require('stream');

    if(file instanceof Readable) {
      // Read and check the HEX file
      me.emit('status', 'Loading File');
      loader = hex.loadStream(file, me.space.hexBlock);
    } else if('string' === typeof(file)) {

      me.emit('status', 'Loading File: ' + file);
      loader = hex.loadFile(file, me.space.hexBlock);

    } else {
      throw new Error('Dont know how to import File');
    }

    // load file into blocks according to desired block size
    return loader
    .then(function(blocks) {

      // if there is a filter to be applied while loading, do it
      if('function' === typeof(me.space.loadFilter)) {
        me.space.loadFilter(blocks, me.space);
      }

      if(me.validateHexFile(blocks)) {

        me.flashBlocks = [];
        me.totalBlocks = 0;

        // determine the CRC of the entire application space
        // do this before filtering for just non-empty blocks, so we get the
        // correct answer
        me.computedCrc = me.space.checksum(me.appStart - me.space.dataOffset, me.appEnd - me.space.dataOffset, me.space.hexBlock, blocks);


        // Filter for blocks we need to send, and apply the send filter
        blocks.forEach(function(block, index) {

          let start = index * space.hexBlock / space.addressing + space.dataOffset;
          let end = ((index + 1) * space.hexBlock / space.addressing) - space.addressing + space.dataOffset;

          if(start >= me.appStart && end <= me.appEnd) {
            if(!space.skipEmptyBlocks || !space.blockIsEmpty(block)) {
              me.totalBlocks++;
              me.flashBlocks.push(me.space.sendFilter(index, block, space.addressing, space.dataOffset));

            } else {
              //console.log( 'Skipping empty block at ',start.toString(16));
            }
          } else {
            //me.emit('status', 'Ignoring out-of-range data at ' + start.toString(16));
          }
        });

      } else {
        throw new Error('Hex file is not compatible with this device');
      }
    });

  }

  /**
   * Builds an array of DATA commands to send to the device
   *
   * @return     Promise  Resolves when all blocks have been sent
   */
  async sendBlocks() {

    let me = this;
    let space = me.space;

    let todo = [];

    me.blocksCompleted = 0;

    // for each block we have, create a Promise to send it.  Put
    // all the promises in the array.
    for( const [index, block] of me.flashBlocks.entries() ) {
      await me.sendAppBlock(index, block);
    }

    //console.log( 'block checksum: ', me.blockChecksum);

    // Return a promise that resolves when all Promises in the array are completed.
    //return Promise.all(todo);
  }


};
