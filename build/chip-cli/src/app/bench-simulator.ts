/**
 * The simulator, laid out like a bench: a reader that can be unplugged, and a tag
 * that is either on it or not.
 *
 * The plain SimulatorTransport always has a tag in the field, which is right for a
 * batch and wrong for the Tag Tool, whose whole job is to notice a tag arrive and
 * leave. This wraps it, through the TagTransport interface only, and adds the two
 * things a person does with their hands: put a tag down and take it off.
 *
 * Every tag put down is a new tag. Taking one off moves the simulated tray on, so
 * the next tag down has the next UID, which is what a stack of blank tags looks
 * like to the real reader. completeUnit does not move the tray: the written tag is
 * still sitting on the reader until someone lifts it.
 */

import { ChipError } from '../chip/errors.js';
import type { AreaProtection } from '../chip/st25tv02kc.js';
import { SimulatorTransport, type SimulatorOptions } from '../transport/simulator.js';
import type { AreaProtectionState, TagIdentity, TagTransport } from '../transport/transport.js';

const PRESENCE_POLL_MS = 20;

function noProtection(): ChipError {
  return new ChipError('USAGE', 'The simulated bench does not lock tags.', 'This is a bug in the Tag Tool. Report it.', {});
}

export interface BenchSimulatorOptions extends SimulatorOptions {
  /** Start with the simulated reader unplugged. */
  readonly readerConnected?: boolean;
}

export class BenchSimulator implements TagTransport {
  readonly name = 'simulator';
  readonly isHardware = false;
  readonly readerName = 'Simulated reader (no hardware)';

  readonly #inner: SimulatorTransport;
  #readerConnected: boolean;
  #tagPresent = false;
  #tagEverPlaced = false;

  constructor(options: BenchSimulatorOptions = {}) {
    this.#inner = new SimulatorTransport(options);
    this.#readerConnected = options.readerConnected ?? true;
  }

  get simulator(): SimulatorTransport {
    return this.#inner;
  }

  get tagPresent(): boolean {
    return this.#tagPresent;
  }

  get readerConnected(): boolean {
    return this.#readerConnected;
  }

  /** Puts a fresh tag on the reader. Does nothing if one is already there. */
  async placeTag(): Promise<void> {
    if (this.#tagPresent) return;
    this.#tagPresent = true;
    this.#tagEverPlaced = true;
  }

  /** Lifts the tag off. The next tag placed is a different one. */
  async removeTag(): Promise<void> {
    if (!this.#tagPresent) return;
    this.#tagPresent = false;
    await this.#inner.completeUnit();
  }

  async unplugReader(): Promise<void> {
    this.#readerConnected = false;
    await this.#inner.releaseTag();
  }

  async plugReader(): Promise<void> {
    this.#readerConnected = true;
  }

  private requireReader(): void {
    if (!this.#readerConnected) {
      throw new ChipError(
        'TRANSPORT_UNAVAILABLE',
        'No reader is plugged in (simulated).',
        'Plug the reader in. In the simulator, press "Plug the reader in".',
        {},
      );
    }
  }

  async open(): Promise<void> {
    this.requireReader();
    await this.#inner.open();
  }

  async close(): Promise<void> {
    await this.#inner.close();
  }

  async waitForTag(timeoutMs: number): Promise<TagIdentity> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      this.requireReader();
      if (this.#tagPresent) return this.#inner.waitForTag(timeoutMs);
      if (Date.now() >= deadline) {
        throw new ChipError(
          'TAG_ABSENT',
          `No tag arrived on the simulated reader within ${timeoutMs} ms.`,
          'Put a tag on the reader. In the simulator, press "Put a tag on".',
          { everPlaced: this.#tagEverPlaced },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(PRESENCE_POLL_MS, Math.max(1, deadline - Date.now()))));
    }
  }

  private requireTag(): void {
    this.requireReader();
    if (!this.#tagPresent) {
      throw new ChipError('TAG_ABSENT', 'The tag left the simulated reader.', 'Put the tag back and try again.', {});
    }
  }

  async readBlocks(firstBlock: number, count: number): Promise<Uint8Array> {
    this.requireTag();
    return this.#inner.readBlocks(firstBlock, count);
  }

  async writeBlock(block: number, data: Uint8Array): Promise<void> {
    this.requireTag();
    return this.#inner.writeBlock(block, data);
  }

  // The Tag Tool never protects a tag, so its bench has no way to either. The plain
  // SimulatorTransport, which chip-cli uses, models all three and the two proofs.
  async presentPassword(_passwordNumber: number, _password: Uint8Array): Promise<void> {
    throw noProtection();
  }

  async writePassword(_passwordNumber: number, _password: Uint8Array): Promise<void> {
    throw noProtection();
  }

  async setAreaProtection(_area: number, _protection: AreaProtection, _passwordNumber: number): Promise<void> {
    throw noProtection();
  }

  async proveWriteRefused(_block: number, _data: Uint8Array, _expectedUid: string | null): Promise<'refused' | 'accepted'> {
    throw noProtection();
  }

  async proveWriteUnlocked(_block: number, _data: Uint8Array, _passwordNumber: number, _password: Uint8Array, _expectedUid: string | null): Promise<void> {
    throw noProtection();
  }

  async readAreaProtection(area: number): Promise<AreaProtectionState> {
    this.requireTag();
    return this.#inner.readAreaProtection(area);
  }

  async releaseTag(): Promise<void> {
    await this.#inner.releaseTag();
  }

  /** The unit is done, and the tag is still on the reader until someone lifts it. */
  async completeUnit(): Promise<void> {
    await this.#inner.releaseTag();
  }
}
