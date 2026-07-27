import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateNetworkRates, formatNetworkRate, parseNetworkCounters } from '../../src/helpers/network.js';

const PROC_NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 100 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
   wg0: 3000 30 0 0 0 0 0 0 4000 40 0 0 0 0 0 0
`;

const interfaceCounters = (name, receivedBytes, transmittedBytes) => ({
    name,
    receivedBytes,
    transmittedBytes,
});
const snapshot = (...interfaces) => ({ interfaces });

test('network counters preserve per-interface values and exclude loopback traffic', () => {
    assert.deepEqual(parseNetworkCounters(PROC_NET_DEV), snapshot(
        interfaceCounters('eth0', 1000, 2000),
        interfaceCounters('wg0', 3000, 4000),
    ));
});

test('network counters can identify a renamed loopback interface from platform flags', () => {
    const renamedLoopback = PROC_NET_DEV.replace('lo:', 'local-only:');
    const isLoopback = (name) => name === 'local-only';

    assert.deepEqual(parseNetworkCounters(renamedLoopback, isLoopback), snapshot(
        interfaceCounters('eth0', 1000, 2000),
        interfaceCounters('wg0', 3000, 4000),
    ));
});

test('network counters return null when no interface row can be parsed', () => {
    assert.equal(parseNetworkCounters(null), null);
    assert.equal(parseNetworkCounters('Inter-| Receive | Transmit'), null);
});

test('network rates use the measured interval rather than the nominal polling interval', () => {
    const previous = snapshot(interfaceCounters('eth0', 1000, 2000));
    const current = snapshot(interfaceCounters('eth0', 7000, 5000));

    assert.deepEqual(calculateNetworkRates(previous, current, 1.5), {
        upload: 2000,
        download: 4000,
    });
});

test('network rates suppress a sample after interface churn', () => {
    const previous = snapshot(interfaceCounters('eth0', 5000, 4000));
    const current = snapshot(
        interfaceCounters('eth0', 6000, 5000),
        interfaceCounters('wg0', 1000, 1000),
    );

    assert.deepEqual(calculateNetworkRates(previous, current, 2), { upload: 0, download: 0 });
});

test('network rates suppress resets even when another interface keeps aggregate counters rising', () => {
    const previous = snapshot(
        interfaceCounters('eth0', 5000, 4000),
        interfaceCounters('wg0', 1000, 1000),
    );
    const current = snapshot(
        interfaceCounters('eth0', 100, 100),
        interfaceCounters('wg0', 10_000, 10_000),
    );

    assert.deepEqual(calculateNetworkRates(previous, current, 2), { upload: 0, download: 0 });
});

test('network rates use compact decimal SI units', () => {
    assert.equal(formatNetworkRate(0, 'en-US'), '0.0 kB/s');
    assert.equal(formatNetworkRate(9500, 'en-US'), '9.5 kB/s');
    assert.equal(formatNetworkRate(12_400, 'en-US'), '12 kB/s');
    assert.equal(formatNetworkRate(1_500_000, 'en-US'), '1.5 MB/s');
    assert.equal(formatNetworkRate(12_400_000, 'en-US'), '12 MB/s');
});

test('network rate values format consistently at unit boundaries', () => {
    assert.equal(formatNetworkRate(999_999, 'en-US'), '1,000 kB/s');
    assert.equal(formatNetworkRate(999_999_999, 'en-US'), '1,000 MB/s');
    assert.equal(formatNetworkRate(999_999_999_999, 'en-US'), '1,000 GB/s');
});
