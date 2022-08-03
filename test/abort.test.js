/**
 * Tests how the module reacts to a user-commanded abort
 */

const Bootloader = require('../');
const MockTransport = require('./MockTransport');
const Modbus = require('@csllc/cs-modbus');

let modbusConfig = {
  "transport": {
    "type": "j1939",
    "connection": {
      "type": "generic",
    }
  },
  "suppressTransactionErrors": true,
  "retryOnException": [0x05],
  "maxConcurrentRequests": 1,

  "defaultMaxRetries": 2,
  "defaultTimeout": 500
};


const sinon = require('sinon');

const expect = require('chai-as-promised').expect;
const assert = require('chai-as-promised').assert;

const MY_ADDR = 0xFE;

describe('User Aborts', function() {

  beforeEach(function(done) {

    this.mock = new MockTransport({

      // how we respond to each enq request
      enq: [
        null,
        { delay: 1000, buf: [0x47, 0xF0, 0x32, 0x04, 0x06, 0x05, 0x00, 0x40] },
      ],
      sel: [
        null,
        { delay: 1000, buf: [0x47, 0xf3, 0x00, 0xc0, 0x00, 0x04, 0x08, 0x00] },
      ],
      erase: [
        null,
        { delay: 1000, buf: [0x47, 0xf8, 0x00] },
      ],
      data: [
        null,
        { delay: 1000, buf: [0x47, 0xf9, 0x00, 0x00, 0x00, 0x24, 0x00] },
      ],
      verify: [
        null,
        { delay: 1000, buf: [0x47, 0xfa, 0x6D, 0x91] },
      ],
      finish: [
        null,
        { delay: 1000, buf: [0x47, 0xfd, 0x00] },
      ],

    });

    modbusConfig.transport = this.mock;

    this.master = Modbus.createMaster(modbusConfig);

    this.master.on('connected', () => done());
  });

  afterEach(function() {
    this.mock.destroy();

  });


  //  ████████╗███████╗███████╗████████╗     ██████╗ █████╗ ███████╗███████╗
  //  ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝    ██╔════╝██╔══██╗██╔════╝██╔════╝
  //     ██║   █████╗  ███████╗   ██║       ██║     ███████║███████╗█████╗
  //     ██║   ██╔══╝  ╚════██║   ██║       ██║     ██╔══██║╚════██║██╔══╝
  //     ██║   ███████╗███████║   ██║       ╚██████╗██║  ██║███████║███████╗
  //     ╚═╝   ╚══════╝╚══════╝   ╚═╝        ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝
  //
  it('should abort properly before ENQ phase', function(done) {

    let me = this;
    let statusSpy = sinon.spy();
    let progressSpy = sinon.spy();

    const bl = new Bootloader(this.master);

    let target = new bl.BootloaderTarget.Target({

      enquireRetries: 5,
      enquireTimeout: 20,
    }, [

      new bl.BootloaderTarget.EEPROM(),

    ]);

    // catch status message from bootloader for display
    bl.on('status', statusSpy);
    bl.on('progress', progressSpy);

    bl.on('status', function(status) {
      if(status === 'Checking Communication') {
        bl.abort();
      }
    });

    // start trying to load the file
    bl.start(__dirname + '/files/64bytes.hex', {
        target: target,
        space: 0
      })
    .then(function() {
      done(new Error('Should not have reported success'));
    })
    .catch(function(err) {

      //expect(me.mock.count.enqs).to.equal(0);
      //assert(statusSpy.calledWithMatch('Aborted'));
      done();
    });

  });

  //  ████████╗███████╗███████╗████████╗     ██████╗ █████╗ ███████╗███████╗
  //  ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝    ██╔════╝██╔══██╗██╔════╝██╔════╝
  //     ██║   █████╗  ███████╗   ██║       ██║     ███████║███████╗█████╗
  //     ██║   ██╔══╝  ╚════██║   ██║       ██║     ██╔══██║╚════██║██╔══╝
  //     ██║   ███████╗███████║   ██║       ╚██████╗██║  ██║███████║███████╗
  //     ╚═╝   ╚══════╝╚══════╝   ╚═╝        ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝
  //
  it('should abort properly during ENQ phase', function(done) {

    let me = this;
    let statusSpy = sinon.spy();
    let progressSpy = sinon.spy();

    const bl = new Bootloader(this.master);

    let target = new bl.BootloaderTarget.Target({

      enquireRetries: 5,
      enquireTimeout: 20,
    }, [

      new bl.BootloaderTarget.EEPROM(),

    ]);


    bl.on('status', statusSpy);
    bl.on('progress', progressSpy);

    // abort while waiting for the response to the second 'enq'
    setTimeout(function() {
      bl.abort();
    },30);



    // start trying to load the file
    bl.start(__dirname + '/files/64bytes.hex', {
        target: target,
        space: 0
      })
    .then(function() {
      done(new Error('Should not have reported success'));
    })
    .catch(function(err) {
      done();
    });

  });


});
