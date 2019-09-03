/**
 * Defines the attributes of various target hardware for the bootloader
 * 
 * These classes are used to customize the behavior of the application for a specific
 * type of target.
 * 
 * Copyright (c) 2019 Control Solutions LLC.  All Rights Reserved
 */

const CRC = require('./crc16');


/**
 * Filter that runs after the data image is loaded from the HEX file
 *
 * The blocks object may be modified as necessary.
 * 
 * @param      array  blocks  The data blocks parsed from the file
 */
function loadHmiAppFilter( blocks ) {

  // nothing is needed for now
  return;
}

/**
 * Filter that runs before a block is sent to the device.
 * 
 * Convert a block of 256 bytes from the hex file into a bootloader block command
 * with 192 data bytes. This is needed for the HMI application space
 * 
 * @param number index indicates which block is being processed
 * @param array block contains the block to be processed
 * @return array bytes to be sent to the device.
 */
function sendHmiAppFilter( index, block ) {

  // Calculate the start address of the block (assumes all blocks are the same length)
  let address = index * block.length / 2;

  // start with 4-byte address, MSB first
  let bytesToSend = [  (address>>24) & 0xFF, (address>>16) & 0xFF, (address>>8) & 0xFF,  (address) & 0xFF ];

  // Add the data, skipping every 4th byte as required by the PIC24 HEX format
  for( let i = 0; i < block.length; i+= 4 ) {
    bytesToSend.push( ...block.slice( i, i + 3 ) );
  }

  // Sum the data bytes being sent, and append the checksum byte
  //let checksum = bytesToSend.reduce(function(a, b){return a+b;})
  //bytesToSend.push( -checksum & 0xFF );

  return bytesToSend;
}

function isPic24BlockEmpty( block ) {
  if( typeof( block ) !== 'object' ) {
    return true;
  }

  for( let i = 0; i < block.length; i+=4 ) {
    if( block[i] !== 0xFF || block[i+1] !== 0xFF || block[i+2] !== 0xff ) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate the CRC for the HMI application
 *
 * CRC over the whole application should be zero, due to the MPLABX project
 * file settings that use hexmate to insert a checksum in the output file
 *
 * @param      {(number|string)}  start      The start
 * @param      {number}           end        The end
 * @param      {<type>}           blockSize  The block size
 * @param      {<type>}           blocks     The blocks
 * @return     {(number|string)}  The hmi application checksum.
 */
function computeHmiAppChecksum( start, end, blockSize, blocks ) {
  return 0;
}

/**
 * Filter that runs before a block is sent to the device.
 * 
 * Convert a block of 256 bytes from the hex file into a bootloader block command
 * with 256 data bytes. This is needed for the HMI FLASH spaces
 * 
 * @param number index indicates which block is being processed
 * @param array block contains the block to be processed
 * @return array bytes to be sent to the device.
 */
function sendSimpleFilter( index, block ) {

  // Calculate the start address of the block (assumes all blocks are the same length)
  let address = index * block.length;

  // start with  4-byte address, MSB first
  let bytesToSend = [ (address>>24) & 0xFF, (address>>16) & 0xFF, (address>>8) & 0xFF,  (address) & 0xFF ];

  // Add the data
  bytesToSend.push( ...block );

  // Sum the data bytes being sent, and append the checksum byte
  //let checksum = bytesToSend.reduce(function(a, b){return a+b;})
  //bytesToSend.push( -checksum & 0xFF );

  return bytesToSend;
}


function isSimpleBlockEmpty( block ) {
  if( typeof( block ) !== 'object' ) {
    return true;
  }

  for( let i = 0; i < block.length; i++ ) {
    if( block[i] !== 0xFF ) {
      return false;
    }
  }

  return true;
}


/**
 * Calculates a CRC over the entire memory space
 *
 * @param      {number}  start      The start memory address
 * @param      {number}  end        The end memory address
 * @param      {number}  blockSize  The block size
 * @param      {<type>}  blocks     The memory blocks
 * @return     {number}  The resulting checksum
 */
function computeSimpleChecksum( start, end, blockSize, blocks ) {

  let crc = 0xFFFF;

  // updates the CRC with the next byte
  function updateByte( byte ){

    crc = CRC.update( crc, byte );
  //  console.log( byte, crc );
  }

  for( let i=start; i < end; i += blockSize ) {

    let blockIndex = Math.floor( i / blockSize);

    if( 'undefined' === typeof( blocks[blockIndex])) {
      // no data in block; it will be all FFs in the device
      for( let j = 0; j < blockSize; j++ ) {
        crc = CRC.update( crc, 0xFF );
      }
    }
    else {
      //console.log( blockIndex, blocks[blockIndex] );
      // there is data in the block; update the crc
      blocks[blockIndex].forEach( updateByte );

    }

  }

  return crc;
}



let TARGET_DEFAULTS = {
  name: 'Device',
  supportsPassThru: false,
  code: 'any',
  type: '',

  // Timeouts for each bootloader command. These can be overridden for
  // a given target, since for example, erase times may vary by size of memory
  enquireTimeout: 250,
  selectTimeout: 250,
  eraseTimeout: 5000,
  dataTimeout: 250,
  verifyTimeout: 5000,
  finishTimeout: 1000,

};

let SPACE_DEFAULT = {
  name: 'Application',
  hexBlock: 64,
  sendBlock: 64,
  addressing: 1,
  sendFilter: sendSimpleFilter,
  checksum: computeSimpleChecksum,
  blockIsEmpty: isSimpleBlockEmpty,

};

class DefaultBootloaderTarget {

  constructor( target, spaces ) {
  
    let me = this;

    me.target = Object.assign( TARGET_DEFAULTS, target );
    me.spaces = spaces || [ SPACE_DEFAULT ];

    me.spaces.forEach( function( space ){

      // make sure all timeouts are set for this space
      space.enquireTimeout = space.enquireTimeout || me.target.enquireTimeout;
      space.selectTimeout = space.selectTimeout || me.target.selectTimeout;
      space.eraseTimeout = space.eraseTimeout || me.target.eraseTimeout;
      space.dataTimeout = space.dataTimeout || me.target.dataTimeout;
      space.verifyTimeout = space.verifyTimeout || me.target.verifyTimeout;
      space.finishTimeout = space.finishTimeout || me.target.finishTimeout;


    });

    me.productCode = me.target.code + me.target.type;

  }

  // Check the enquire response bytes to make sure we are connected to the right device
  isCompatible( response ) {

    let expectedCode = this.target.code + this.target.type;
    //console.log( expectedCode, response[0]);
    if( this.target.code !== 'any' && expectedCode !== response[0] ) {
      return 'Did not find the expected device';
    }

    if( response[3] < this.spaces.length ) {
      return 'Found unsupported device';
    }

    return true;
  }

}

class DefaultPic18Target extends DefaultBootloaderTarget {

  constructor() {

    super({
      name: 'Controller',
      supportsPassThru: false,
      code: 0x21,
      type: 0x01,

      connection: 'uart',
      baudrate: 115200,

    }, [{
      name: 'Application',
      hexBlock: 64,
      sendBlock: 64,
      addressing: 1,
      sendFilter: sendSimpleFilter,
      checksum: computeSimpleChecksum,
      blockIsEmpty: isSimpleBlockEmpty,
    }]);

  }
}

class CS1451Target extends DefaultBootloaderTarget {

  constructor() {

    super({
      name: 'Controller',
      supportsPassThru: true,
      code: 0x20,
      type: 0x01,

      connection: 'uart',
      baudrate: 230400,

    }, [{
      name: 'Application',
      hexBlock: 64,
      sendBlock: 64,
      addressing: 1,
      sendFilter: sendSimpleFilter,
      checksum: computeSimpleChecksum,
      blockIsEmpty: isSimpleBlockEmpty,
    }]);

  }
}


class CS1814Target extends DefaultBootloaderTarget {

  constructor() {

    super({
      name: 'Bluetooth Adapter',
      supportsPassThru: false,
      code: 0x20,
      type: 0x01,

      connection: 'uart',
      baudrate: 115200,

    }, [{
      name: 'Application',
      hexBlock: 64,
      sendBlock: 64,
      addressing: 1,
      sendFilter: sendSimpleFilter,
      checksum: computeSimpleChecksum,
      blockIsEmpty: isSimpleBlockEmpty,
    }]);

  }

}


class CS1435Target extends DefaultBootloaderTarget {

  constructor() {

    super({
      name: 'HMI',
      supportsPassThru: false,
      code: 0x00,
      type: 0x02,

      connection: 'uart',
      baudrate: 230400,

      // longer timeouts since we might be communicating to this device via another device (pass thru)
      enquireTimeout: 500,
      selectTimeout: 500,
      eraseTimeout: 5000,
      dataTimeout: 500,
      verifyTimeout: 5000,
      finishTimeout: 1000,


    },[{
        name: 'Application',
        hexBlock: 256,
        sendBlock: 192,
        addressing: 2,
        loadFilter: loadHmiAppFilter,
        sendFilter: sendHmiAppFilter,
        checksum: computeHmiAppChecksum,
        blockIsEmpty: isPic24BlockEmpty,
      },{
        name: 'Flash #1',
        hexBlock: 4096,
        sendBlock: 4096,
        addressing: 1,
        // loadFilter: function( blocks ) {},
        sendFilter: sendSimpleFilter,
        checksum: computeSimpleChecksum,
        blockIsEmpty: isSimpleBlockEmpty,
        dataTimeout: 2000,
        eraseTimeout: 60000,
        verifyTimeout: 60000,

      },{
        name: 'Flash #2',
        hexBlock: 4096,
        sendBlock: 4096,
        addressing: 1,
        sendFilter: sendSimpleFilter,
        checksum: computeSimpleChecksum,
        blockIsEmpty: isSimpleBlockEmpty,
        dataTimeout: 2000,
        eraseTimeout: 60000,
        verifyTimeout: 60000,
      }]
    );

  }

}



/**
 * Class with bootloader parameters for a PIC24 device
 *
 * @class      PIC24Application (name)
 */
class PIC24Application {
  constructor( options ) {
    options = options || {};

    this.name = options.name || 'PIC24';
    this.hexBlock = options.hexBlock || 256;

    this.sendBlock = options.sendBlock || 192;
   
    this.addressing = 2;
    this.loadFilter = loadHmiAppFilter;
    this.sendFilter = sendHmiAppFilter;
    this.checksum = computeHmiAppChecksum;
    this.blockIsEmpty = isPic24BlockEmpty;
  }
}


module.exports = {

  DefaultPic18Target: DefaultPic18Target,
	
  default: DefaultBootloaderTarget,
  CS1451: CS1451Target,
  CS1814: CS1814Target,
  CS1435: CS1435Target,

  Target: DefaultBootloaderTarget,
  PIC24Application: PIC24Application,
};