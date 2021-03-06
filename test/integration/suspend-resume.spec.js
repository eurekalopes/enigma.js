import crypto from 'crypto';
import WebSocket from 'ws';
import Qix from '../../src/qix';
import Schema from '../../schemas/12.20.0.json';

function generateId() {
  return crypto.randomBytes(20).toString('hex');
}

function buildUrl(ttl) {
  ttl = typeof ttl !== 'undefined' ? ttl : 300;
  return `ws://localhost:9076/app/engineData/ttl/${ttl}/identity/${generateId()}`;
}

// N.B. This test will only pass when run towards an engine supporting the session TTL feature.
describe('QIX Suspend/Resume', () => {
  let config;

  beforeEach(() => {
    config = {
      schema: Schema,
      url: buildUrl(),
      createSocket: url => new WebSocket(url),
    };
  });

  it('should suspend and resume by reattaching', () => {
    let handleBeforeResume;
    let propertiesBeforeResume;

    return Qix.create(config).open().then(global =>
      global.createSessionApp().then(app =>
        app.createObject({ qInfo: { qId: 'OBJ01', qType: 'abc' } })
          .then(() => app.destroyObject('OBJ01'))
          .then(() => app.createObject({ qInfo: { qId: 'OBJ02', qType: 'abc' } }))
          .then((obj) => {
            handleBeforeResume = obj.handle;
            return obj.getProperties()
              .then((props) => { propertiesBeforeResume = props; })
              .then(() => global.session.suspend())
              .then(() => global.session.resume(false))
              .then(() => expect(handleBeforeResume).to.not.equal(obj.handle))
              .then(() => obj.getProperties())
              .then(props => expect(propertiesBeforeResume).to.deep.equal(props))
              .then(() => global.session.close());
          })));
  });

  it('should suspend and resume by reopening the previous document', () => {
    config.url = buildUrl(0);
    const suspended = sinon.spy();
    const closed = sinon.spy();
    const session = Qix.create(config);
    /* eslint no-console:0 */
    session.on('traffic:*', console.log);
    session.on('suspended', suspended);
    session.on('closed', closed);
    const id = generateId();
    let global;
    let app;

    return session.open()
      // save ref to global API:
      .then((g) => { global = g; })
      // create our test app:
      .then(() => global.createApp(id))
      // open our test app:
      .then(() => global.openDoc(id))
      // save ref to app API:
      .then((a) => { app = a; })
      // set a dummy property that we don't save:
      .then(() => app.setAppProperties({ test: true }))
      .then(() => session.suspend())
      .then(() => expect(suspended.calledOnce).to.equal(true))
      .then(() => global.session.resume())
      .then(() => app.getAppProperties())
      // verify that we have reconnected to a fresh app, since we never saved
      // this property it shouldn't exist in a new one:
      .then(props => expect(props.test).to.equal(undefined))
      .then(() => global.deleteApp(app.id))
      .then(() => session.close())
      .catch(error => session.close().then(() => Promise.reject(error)))
      .then(() => expect(closed.callCount).to.equal(1));
  });

  it('should suspend session when socket was disconnected', () => {
    config.suspendOnClose = true;
    const suspended = sinon.spy();
    const closed = sinon.spy();
    const session = Qix.create(config);
    session.on('suspended', suspended);
    session.on('closed', closed);
    return session.open().then(() => session.rpc.close(4029)).then(() => new Promise((resolve) => {
      setTimeout(resolve, 1000);
    }).then(() => {
      expect(suspended.calledOnce).to.equal(true);
      expect(closed.calledOnce).to.equal(false);
    }));
  });
});
