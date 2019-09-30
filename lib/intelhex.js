/**
 * Handles text files containing Intel Hex records
 */

//Intel Hex record types
const DATA = 0,
  END_OF_FILE = 1,
  EXT_SEGMENT_ADDR = 2,
  START_SEGMENT_ADDR = 3,
  EXT_LINEAR_ADDR = 4,
  START_LINEAR_ADDR = 5;

const EMPTY_VALUE = 0xFF;


// Convert a hex string to a byte array
function hexToBytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substr(c, 2), 16));
  }
  return bytes;
}

module.exports = class HexFile {
  constructor(  ) {

    let me = this;
    
    // a state-full variable to keep track of the high byte(s) of the address
    me.extendedAddress = 0;
    me.blocks = [];
    me.blockSize = 0;
    me.linesInFile = 0;
    me.fillValue = EMPTY_VALUE;

  }


  parseHexLine( line ) {

    let bytes = hexToBytes( line.slice( 1 ));

    if( bytes.length > 4 ) {

      let count = bytes[0];
      let sum = 0;
      bytes.forEach( function( byte ){
        sum = (sum + byte ) & 0xFF;
      });

      let data = bytes.slice( 4, bytes.length-1 );

      if( count !== data.length || sum !== 0 ) {
        throw new Error( 'Invalid data in HEX file line: '+ this.linesInFile );

      }
      else {
        return {
          count: count,
          address: bytes[1] * 256 + bytes[2],
          type: bytes[3],
          data: data
        };
      }
    }
    else {
      
      throw new Error( 'Invalid HEX file line: ' + this.linesInFile );
    }

  }

  // Add bytes to a block. Create the block if it doesn't exist.
  // does not check for block overruns
  blockUpdate( blockIndex, offset, bytes ) {
    let me = this;

    if( 'object' !== typeof( me.blocks[blockIndex] )) {
  
      let newBlock = new Array(me.blockSize);
      newBlock.fill( me.fillValue );

      me.blocks[blockIndex] = newBlock;
    }

    me.blocks[ blockIndex ].splice( offset, bytes.length, ...bytes );

  }


  addData( record ) {
    let me = this;

    // this is true for certain hex files (PIC24) but not all
    // if( (record.data.length % 4)  > 0 ) {
       //console.log( record);
    //   throw new Error( 'Incorrect data byte format' );
    // }

    let effectiveAddress = me.extendedAddress + record.address;

    let block = Math.floor(effectiveAddress / me.blockSize);
    let offset = (effectiveAddress % me.blockSize );

    //console.log( 'EFF: ', (effectiveAddress/2).toString(16), block, effectiveAddress / me.blockSize );     

    // number of bytes we can write into block
    let available = (me.blockSize - offset);

    if( available < record.data.length ) {
      //console.log( 'split block: ', block, 'offset:', offset, available, record.data );
      // all the bytes don't fit in one block
      me.blockUpdate( block, offset, record.data.slice( 0, available ) );
      me.blockUpdate( block+1, 0, record.data.slice( available ) );
      //console.log( me.blocks[block], me.blocks[block+1] );

    }
    else {
      me.blockUpdate( block, offset, record.data );
    }

  }


  processRecord( record ) {
    let me = this;

    switch( record.type ) {
      case DATA:
        me.addData( record );
        break;

      case END_OF_FILE:
        // handled elsewhere
        break;

      case EXT_SEGMENT_ADDR:
        throw new Error( 'Unhandled HEX record ' + EXT_SEGMENT_ADDR );

      case START_SEGMENT_ADDR:
        throw new Error( 'Unhandled HEX record ' + START_SEGMENT_ADDR );

      case EXT_LINEAR_ADDR:
        me.extendedAddress = (record.data[0] << 24) +
                      (record.data[1] << 16);
        //console.log( 'Ext: ', me.extendedAddress.toString(16));             
        break;

      case START_LINEAR_ADDR:
        throw new Error( 'Unhandled HEX record ' + START_LINEAR_ADDR );

      default:
        throw new Error( 'Unknown Record type: ' + record.type );
    }

  }

  // Reads a file into an array of blockSize-d arrays
  // Returns the array.
  // Throws if file not found
  loadFile( filename, blockSize ) {

    let me = this;

    return new Promise( function( resolve, reject ) {

      me.blockSize = blockSize;
      me.blocks = [];        
      me.linesInFile = 0;

      let errors = 0;
      let complete = 0;
      let errorText = '';

      // when done for any reason, close out the promise
      function done() {
        
        if( errors > 0 ){

          reject( 'Error(s) occured reading the HEX file: ' + errorText );

        }
        else if( complete ) {

          resolve( me.blocks );
        }
        else {
          reject('Incomplete file');
        }
      }

      let stream = require('fs').createReadStream(filename);

      let lineReader = require('readline').createInterface({
        input: stream
      });

      stream.on('error', function () {
        errors = 1;
        errorText = 'File read error';
        done();
      });



      lineReader.on('line', function (line) {
        me.linesInFile++;

        line = line.trim();

        if( line > '' ) {

          try {
            let record = me.parseHexLine( line );

            if( record.type === END_OF_FILE ) {
              complete = 1;
            }
            else {
              me.processRecord( record );
            }
          }
          catch( e ) {

            if( errorText === '' ) {
              errorText = e.message;
            }

            errors++;
          }

        }
      });

      // End of file
      lineReader.on('close', done );

    });
  }
};