// Runs the calculation off the page's main thread so big fights don't freeze the page.
importScripts('engine.js');
onmessage = e => postMessage({ id: e.data.id, result: self.MESBG.calculate(e.data.input) });
