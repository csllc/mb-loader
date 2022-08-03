

const IntelHex = require( '../lib/intelhex');

let hex = new IntelHex();

const blocksize = 128;

hex.loadFile( '/Users/bill/Documents/Subversion/Karcher/CS1436_TREX_HMI/scripts/testfiles/flash4.hex', blocksize)
.then( function( data ) {

	console.log( data.length + ' blocks of ' + blocksize + ', ' + blocksize * data.length + ' bytes');

	data.forEach( function( block, index ){

		// console.log('Block ' + (index * 128).toString(16), JSON.stringify( block ));

		// console.log('Block ' + (index * 128).toString(16), JSON.stringify( block ));

	});
	//console.log( JSON.stringify( data ));
});


