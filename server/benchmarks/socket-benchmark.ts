import { performance } from 'node:perf_hooks';
import { createSocketHarness } from '../tests/performance/socket-harness';

function requireSuccess(response: { success: boolean; error?: string }): void {
  if (!response.success) throw new Error(response.error ?? 'Benchmark action failed.');
}

async function main(): Promise<void> {
  const harness = await createSocketHarness(3);
  try {
    const actorId = harness.accountIds[0][0];
    if (harness.roomCodes.length !== 3 || harness.clients.flat().length !== 12) throw new Error('Invalid benchmark fixture.');
    async function measure(name: string, actions: number, operation: () => Promise<void>, verify: () => void): Promise<void> {
      harness.resetMetrics();
      const started = performance.now();
      await operation();
      const elapsedMs = Number((performance.now() - started).toFixed(2));
      verify();
      const { snapshots, payloadBytes, snapshotPayloadBytes, chatPayloadBytes, runtimeWrites, recipients } = harness.metrics;
      process.stdout.write(`${JSON.stringify({
        node: process.version, platform: process.platform, arch: process.arch,
        workload: name, rooms: 3, accounts: 12, actions, snapshots,
        payloadBytes, payloadBytesScope: 'player:state', snapshotPayloadBytes, chatPayloadBytes,
        totalPayloadBytes: snapshotPayloadBytes + chatPayloadBytes,
        runtimeWrites, uniqueRecipientAccounts: recipients.size, elapsedMs,
      })}\n`);
    }
    const actor = harness.clients[0][0];
    await measure('chat', 1, async (): Promise<void> => {
      requireSuccess(await actor.timeout(5_000).emitWithAck('chat:send', { message: 'Benchmark message' }));
    }, (): void => {
      if (harness.metrics.runtimeWrites !== 1 || harness.metrics.chatMessages !== 4 ||
        harness.accountIds[0].some((id) => harness.metrics.chatViews.get(id)?.at(-1)?.content !== 'Benchmark message')) {
        throw new Error('Chat benchmark did not commit and deliver the expected message.');
      }
    });
    await measure('unchanged-resume', 10, async (): Promise<void> => {
      for (let action = 0; action < 10; action += 1) {
        requireSuccess(await actor.timeout(5_000).emitWithAck('player:resume'));
      }
    }, (): void => {
      if (harness.metrics.runtimeWrites !== 0 || harness.metrics.snapshots !== 40 || harness.metrics.recipients.size !== 4) {
        throw new Error('Resume benchmark did not exercise the unchanged read-only workload.');
      }
    });
    await measure('leave-room', 1, async (): Promise<void> => {
      requireSuccess(await actor.timeout(5_000).emitWithAck('room:leave'));
    }, (): void => {
      const departed = harness.metrics.latestSnapshots.get(actorId);
      if (harness.metrics.runtimeWrites !== 1 || !departed || departed.room !== undefined ||
        harness.accountIds[0].slice(1).some((id) => harness.metrics.latestSnapshots.get(id)?.room?.seats.N.player !== null)) {
        throw new Error('Leave benchmark did not durably remove the actor from its room.');
      }
    });
  } finally {
    await harness.close();
  }
}

void main().catch((error: unknown): void => {
  console.error(error);
  process.exitCode = 1;
});
