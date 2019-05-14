/**
 * Utility for calculating a CRC-16 checksum
 * 
 * Use the 'update' function on each byte in your array to calculate the CRC
 *
 */

// The Generator Polynomial: x^16 + x^15 + x^2 + 1
const CRC16_GEN_POLY = 0xA001;

// Lookup table
const CRC_TABLE_SIZE = 256;
let _CRCTable = [];




for( let i = 0; i < CRC_TABLE_SIZE; i++ )
{
    let crc = 0;
    let c = i;

    for( let j = 0; j < 8; j++ )
    {

        if( ( crc ^ c ) & 0x0001 )
            crc = ( crc >> 1 ) ^ CRC16_GEN_POLY;
        else
            crc = crc >> 1;

        c = c >> 1;
    }

    _CRCTable[ i ] = crc;
}

// // Initialize the table (happens once)
// let i, j, tcrc;

// for(i=0; i < CRC_TABLE_SIZE; i++) {
//   tcrc = (i << 8); // Put i into MSB 

//   for(j=0; j < 8; j++)  {
//     // Do 8 reductions
//     tcrc = (tcrc << 1) ^((tcrc & 0x8000)? CRC16_GEN_POLY:0);
//   }

//   _CRCTable[i] = tcrc & 0xFFFF;
// }


module.exports = {

	// Updates the given CRC value based on the input data byte
	update( crc, data ) {
    //return (_CRCTable[((crc >> 8) ^ data) & 0xFF] ^ (crc << 8)) & 0xFFFF;

    return ( crc >> 8 ) ^ _CRCTable[ ( crc ^ (data & 0xFFFF) ) & 0x00FF ];
          
  }


};




