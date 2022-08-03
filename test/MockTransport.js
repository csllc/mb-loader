/**
 * Defines some classes used to mock the embedded end of the bootloader
 *
 * You can use mocks to allow testing without an actual device connected.
 */

const Modbus = require('@csllc/cs-modbus');

const MB_COMMAND = 0x47;

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

const DEFAULT_OPTIONS = {

  // how we respond to each enq request
  enq: [
    null,
  ],
  sel: [
    null,
  ],
  erase: [
    null,
  ],
  data: [
    null,
  ],
  verify: [
    null,
  ],
  finish: [
    null,
  ],

};

function findTransactionState(states, transaction) {

  return states.findIndex((item) => item.transaction === transaction);

}

function removeTransactionState(states, index) {

  if(index > -1) {
    // if we have a timer running, cancel it
    if(states[index].timer) {
      clearTimeout(states[index].timer);

    }
    states.splice(index, 1);
  }
}

function genericHandleBootloaderCommand(command, mock, transactionState) {

  let transaction = transactionState.transaction;

  if(mock.options[command].length > transaction.failures) {
    //console.log(transaction.failures);
    let instructions = mock.options[command][transaction.failures];
    let request = transaction.request;

    if(instructions) {
      //console.log('setting timer for ', instructions);
      let timer = setTimeout(function() {
        transactionState.timer = null;
        let index = findTransactionState(mock.transactionStates, transaction);
        removeTransactionState(mock.transactionStates, index);
        //console.log('response',command, instructions.buf);
        transaction.handleResponse(request.createResponse(Buffer.from(instructions.buf)));

      }, instructions.delay);

      transactionState.timer = timer;
    }
  }
}


module.exports = class MockTransport extends Modbus.Transport {

  constructor(options) {

    let connection = new Modbus.Connection();
    connection.isOpen = () => true;

    super(connection);

    this.options = Object.assign({}, DEFAULT_OPTIONS, options);

    // by default use our handlers; caller might substitute their own
    this.handleEnq = function(mock, transactionState) { genericHandleBootloaderCommand('enq', mock, transactionState) };
    this.handleSel = function(mock, transactionState) { genericHandleBootloaderCommand('sel', mock, transactionState) };
    this.handleErase = function(mock, transactionState) { genericHandleBootloaderCommand('erase', mock, transactionState) };
    this.handleData = function(mock, transactionState) { genericHandleBootloaderCommand('data', mock, transactionState) };;
    this.handleVerify = function(mock, transactionState) { genericHandleBootloaderCommand('verify', mock, transactionState) };
    this.handleFinish = function(mock, transactionState) { genericHandleBootloaderCommand('finish', mock, transactionState) };

    this.transactionStates = [];

    // count how many times we receive each kind of bootloader message
    this.count = {
      enqs: 0,
      sels: 0,
      erases: 0,
      datas: 0,
      verifies: 0,
      finishes: 0,
    };

    process.nextTick(() => connection.emit('open'));
  }

  // return an array of pending transactions
  getNonCancelledTransactions() {
    return this.transactionStates.map((state) => state.transaction)
    .filter((trans) => trans.cancelled === false);
  }

  // return an array of  transactions we are dealing with
  getOpenTransactions
    () {
      return this.transactionStates.map((state) => state.transaction);
    }

  /**
   * Returns a function that the Transaction will call if it times out
   *
   * We need to get rid of the transaction in our list of pending
   * transactions
   *
   * @param {Transaction} the transaction
   * @returns {function}
   */
  createTimeoutHandler(transaction) {
    var states = this.transactionStates;

    return function() {

      let index = findTransactionState(states, transaction);

      removeTransactionState(states, index);

    };
  }

  sendRequest(transaction) {

    //console.log('sendRequest', transaction);

    let transactionState = {
      timer: null,
      transaction: transaction
    };

    this.transactionStates.push(transactionState);

    transaction.start(this.createTimeoutHandler(transaction));

    let request = transaction.request;

    switch (request.code) {
      case MB_COMMAND:
        this.onCommand(transactionState);
        break;

      default:
        break;
    }
  }

  onCommand(transactionState) {

    let request = transactionState.transaction.request;

    switch (request.id) {
      case BL_OP_ENQUIRE:
        this.count.enqs++;

        this.handleEnq(this, transactionState);
        break;
      case BL_OP_SELECT:
        this.count.sels++;
        this.handleSel(this, transactionState);
        break;

      case BL_OP_ERASE:
        this.count.erases++;
        this.handleErase(this, transactionState);
        break;

      case BL_OP_DATA:
        this.count.datas++;
        this.handleData(this, transactionState);
        break;

      case BL_OP_VERIFY:
        this.count.verifies++;
        this.handleVerify(this, transactionState);
        break;

      case BL_OP_FINISH:
        this.count.finishes++;
        this.handleFinish(this, transactionState);
        break;

      default:
        break;
    }
  }
}
