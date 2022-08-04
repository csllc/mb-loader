# mb-loader

Coordinates the 'loader' side of firmware update.  This package marshals a HEX file of arbitrary size to an embedded bootloader via a communication link like CANBUS, Serial, etc. The protocol used is detailed in Control Solutions internal document number DOC0004177A.

This package does not implement a user interface; it accepts a path to a HEX file (or a block of HEX data) and some configuration settings.  The application using this package is expected to provide a means for the user to select the correct hex file, initiate the download, and present status.

For communication, the mb-loader accepts an instance of the communication 'master', such as `@csllc/cs-modbus`.  This master instance should be provided in a ready-to-use state (communication port open, etc - the mb-loader will not change the state of the communication path; only use it to send and receive messages (Protocol Data Units or PDUs) to the embedded device.

The mb-loader is indifferent to the type of communication path; it can use a cs-modbus instance that is set up for serial, CANBUS, Bluetooth, TCP/IP, etc - however the timeout configuration provided to mb-loader should be consistent with the communication path (transferring a large block over a slow serial link would be expected to take longer than over a high speed CANBUS).

The software incorporating mb-loader may be referred to as the 'Host' or 'Loader' and typically runs on a PC, mobile device, etc.  The software receiving the HEX file is typically embedded in a device and is referred to as the 'Target', 'Device', or 'Bootloader'.  The Target consists of one or more programmable 'Spaces' (eg memory devices or segments) which accept a HEX file to be programmed.  Examples would be on-chip FLASH memory, EEPROM memory, etc within a Target device. The loading process consists of choosing a hex file that is intended for a Space in the Target, erasing the memory Space, sending chunks of memory bytes, then verifying that the memory image has been transferred and stored correctly.

In order to use this package, the Target must contain Bootloader software as per DOC0004177A.  The means to 'get into the Bootloader' is not handled by mb-loader; the details vary depending on the design of the device (eg pressing a button, delaying at powerup, etc).  The first phase of communication used by mb-loader is to repeatedly send 'ENQ' (enquiry) messages at the Target, and look for a valid response, indicating that the Target is ready to proceed with loadng a memory image.  Likewise, getting 'out of the Bootloader' is left to the Target implementation.  Typically once an ENQ handshake occurs, the Target shuts down any normal processing and solely handles Bootloader protocol messages until a successful 'Verify' or 'Finish' sequence occurs.  

## Host/Target Communication
As detailed in DOC0004177A, loading of a memory image follows the basic pattern:

* ENQ handshake: the Target's response to the ENQ message indicates that it is ready to proceed, and contains some vital bits of information like the product type, number of memory spaces that are loadable, and the bootloader version.  Note that mb-loader uses the Major portion of the version identifier to determine compatibility and availability of certain protocol features.  For example, version '4.5' of the Target bootloader has a major version of '4', and mb-loader will adapt its communication style to version 4.  mb-loader does not care about the minor version byte (in this case, '5').  If the major version byte is unrecognized, mb-loader will error out and refuse to load the image, since it assumes it does not know how to communicate properly with the Target.
* SEL-ection of memory space: The Host tells the Target which of its memory spaces are to be loaded, and the Target returns some parameters about that space, such as its size, and the max data block size it can accept.
* ERASE the memory space: Host tells the Target to erase the SELected space and Target cofirms when complete
* DATA: blocks of memory bytes are transferred one by one and acknowledged by the Target.  It is not necessary to send all data bytes for the memory space, or even send them in order; however the target must acknowledge receipt of each block sent or the transfer will report a failure
* VERIFY provides a means for the Host to request verification of correct receipt/programming of the memory space.  Typically this consists of the Target computing a 16-bit CRC over the entire memory Space and returning that value to the Host, which compares it to the expected value.
* FINISH: if no more Spaces are to be SEL-ected and programmed, this message allows the Host to tell the Target to go back to normal operation and expect nothing further from mb-loader.

## Installation
Install the package using
`npm install @csllc/mb-loader`.  You will also need packages to handle the communication with the Target (eg `@csllc/cs-modbus` and `serialport`).

## Using mb-loader

The `examples` folder contains several complete examples; the basic outline is

### Establish the communication path (master) and construct a Bootloader instance using that master:
``` js

const Bootloader = require('@csllc/mb-loader');

 ...

const bl = new Bootloader(master);

```

### Set up event handlers to display progress/status messages:
``` js
// catch status message from bootloader for display
bl.on('status', function(status) {
  console.log(status);
});

// Catch progress counter
bl.on('progress', function(percent) {
  printProgress(percent);
});

```

### Select hex file and configuration options

Start the HEX transfer and wait for the process to complete:

``` js
bl.start(filename, config)
.then(function() {
  console.log('Success!');   
})
.catch(function(err) {

  console.error('Failed! ', err);
});


```

## Configuration

Configuration of the communication path (master) is outside the scope of this documentation; refer to DOC0004177A, DOC0003824A,  @csllc/cs-modbus, or the Target device documentation.

### Hex file

The first parameter of the .start() method is the HEX image to be loaded.  This parameter can be a file path (eg './my_hex_file.hex'), a string containing INTEL HEX-formatted data, or an instance of a Readable Stream (which is convenient if the HEX data is contained in a compressed file, network server, etc such that the Host software implements custom processing to obtain the HEX data).
The HEX data will be read into memory, and chunked up into blocks according to the Target configuration.

There are some sample HEX files in the test/files folder.  Hexmate (supplied with Microchip's MPLABX IDE) is a handy tool for generating hex files.  Example command line:

Generate a 512 MB file (addresses 0-7FFFF), filled with 0x55
`hexmate -FILL=0x55@0x0:0x1FFFFFFF  -O512MB.hex`

### Target configuration
The second parameter of the .start() method tells mb-loader everything it needs to know about how to transfer the hex data to the device and its memory Spaces - for example, how large the transferred data chunks should be, how long the erase operation should take, how to compute a CRC for verification, and many other parameters.  For convenience, mb-loader contains several 'standard' memory space configurations that can be used as a basis for specifying the Target and Spaces.

This parameter has the following required parameters:
``` js
{
      target: (an instance of BootloaderTarget)
      space: 0 (the index of the memory space within Bootloader Target that is to be loaded.)
}
```


