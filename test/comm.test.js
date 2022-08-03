/**
 * Tests how the module reacts to various communication-related scenarios
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

const expect = require('chai').expect;
const assert = require('chai').assert;

const MY_ADDR = 0xFE;

describe('Communication Glitches', function() {

  beforeEach(function(done) {


    this.mock = new MockTransport({

      // how we respond to each enq request
      enq: [
        null,
        { delay: 10, buf: [0x47, 0xF0, 0x32, 0x04, 0x06, 0x05, 0x00, 0x40] },
      ],
      sel: [
        null,
        { delay: 10, buf: [0x47, 0xf3, 0x00, 0xc0, 0x00, 0x04, 0x08, 0x00] },
      ],
      erase: [
        null,
        { delay: 10, buf: [0x47, 0xf8, 0x00] },
      ],
      data: [
        null,
        { delay: 10, buf: [0x47, 0xf9, 0x00, 0x00, 0x00, 0x24, 0x00] },
      ],
      verify: [
        null,
        { delay: 10, buf: [0x47, 0xfa, 0x6D, 0x91] },
      ],
      finish: [
        null,
        { delay: 10, buf: [0x47, 0xfd, 0x00] },
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
  it('should retry if no response to first ENQ', function(done) {

    let me = this;
    let statusSpy = sinon.spy();
    let progressSpy = sinon.spy();

    const bl = new Bootloader(this.master);

    // define how we interact with the target
    // the main thing here is the enquireTimeout and other timeouts
    // are longer than the mocked
    // transport delay, so we will receive an 'enq' response before the
    // bootloader times out
    let target = new bl.BootloaderTarget.Target({

      name: 'MockDevice',
      enquireRetries: 1,
      enquireTimeout: 20,
      selectTimeout: 20,
    }, [

      new bl.BootloaderTarget.EEPROM({
        hexBlock: 64,
        sendBlock: 64,
        eraseTimeout: 20,
        dataTimeout: 20,
        verifyTimeout: 20,
        finishTimeout: 20,
      }),

    ]);

    // catch status message from bootloader for display
    bl.on('status', statusSpy);
    bl.on('progress', progressSpy);

    // start trying to load the file
    bl.start(__dirname + '/files/64bytes.hex', {
        target: target,
        space: 0
      })
    .then(function() {
      expect(me.mock.count.enqs).to.equal(2);
      assert(statusSpy.calledWithMatch('Checksum:'));
      done();
    })
    .catch(function(err) {
      done(err);
    });

  });

  //  ████████╗███████╗███████╗████████╗     ██████╗ █████╗ ███████╗███████╗
  //  ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝    ██╔════╝██╔══██╗██╔════╝██╔════╝
  //     ██║   █████╗  ███████╗   ██║       ██║     ███████║███████╗█████╗
  //     ██║   ██╔══╝  ╚════██║   ██║       ██║     ██╔══██║╚════██║██╔══╝
  //     ██║   ███████╗███████║   ██║       ╚██████╗██║  ██║███████║███████╗
  //     ╚═╝   ╚══════╝╚══════╝   ╚═╝        ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝
  //
  it('should fail if no response to any ENQ', function(done) {

    let me = this;
    let statusSpy = sinon.spy();
    let progressSpy = sinon.spy();

    const bl = new Bootloader(this.master);

    // define how we interact with the target
    let target = new bl.BootloaderTarget.Target({

      name: 'MockDevice',

      // timeout shorter than our mocked transport so we will not get a response
      enquireRetries: 1,
      enquireTimeout: 1,
      selectTimeout: 10,

    }, [

      new bl.BootloaderTarget.EEPROM({
        hexBlock: 64,
        sendBlock: 64,
        eraseTimeout: 10,
        dataTimeout: 10,
        verifyTimeout: 10,
        finishTimeout: 10,
      }),

    ]);

    // catch status message from bootloader for display
    bl.on('status', statusSpy);
    bl.on('progress', progressSpy);

    // start trying to load the file
    bl.start(__dirname + '/files/64bytes.hex', {
        target: target,
        space: 0
      })
    .then(function() {

      done(new Error('Should not have reported success'));
    })
    .catch(function(err) {

      //console.log('BL', statusSpy.getCalls());
      expect(me.mock.count.enqs).to.equal(2);
      expect(me.mock.count.sels).to.equal(0);
      expect(bl.transactions.length).to.equal(0);
      expect(me.mock.getOpenTransactions().length).to.equal(0);

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
  it('should fail if unexpected response to ENQ', function(done) {

    let me = this;
    let statusSpy = sinon.spy();
    let progressSpy = sinon.spy();

    const bl = new Bootloader(this.master);

    // respond with a verify acknowledgement when we send the ENQ.
    // I suppose this could happen if the bootloader is aborted during a long
    // verify operation, and restarted before the embedded target returns the result
    this.mock.options.enq[0] = this.mock.options.verify[1];
    // define how we interact with the target
    let target = new bl.BootloaderTarget.Target({

      name: 'MockDevice',

      // timeout shorter than our mocked transport so we will not get a response
      enquireRetries: 0,
      enquireTimeout: 20,
      selectTimeout: 20,

    }, [

      new bl.BootloaderTarget.EEPROM({
        hexBlock: 64,
        sendBlock: 64,
        eraseTimeout: 10,
        dataTimeout: 10,
        verifyTimeout: 10,
        finishTimeout: 10,
      }),

    ]);

    // catch status message from bootloader for display
    bl.on('status', statusSpy);
    bl.on('progress', progressSpy);

    // start trying to load the file
    bl.start('', {
        target: target,
        space: 0
      })
    .then(function() {

      done(new Error('Should not have reported success'));
    })
    .catch(function(err) {

      expect(me.mock.count.enqs).to.equal(1);
      expect(me.mock.count.sels).to.equal(0);
      expect(bl.transactions.length).to.equal(0);
      expect(me.mock.getOpenTransactions().length).to.equal(0);

      done();
    });

  });

});
