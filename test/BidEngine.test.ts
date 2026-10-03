import assert from "node:assert/strict";
import hre from "hardhat";
import { Contract, Signer } from "ethers";
import { CofheErrorCode, Encryptable, FheTypes, isCofheError } from "@cofhe/sdk";

const { ethers } = hre;

type Client = Awaited<ReturnType<typeof hre.cofhe.createClientWithBatteries>>;

// Mocha injects these when Hardhat runs the file. They are declared here because
// @types/mocha is not a direct dependency, and this Android config does not load
// hardhat-toolbox (that barrel is what normally pulls chai in).
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(name: string, fn: (this: MochaContext) => void): void;
declare function it(name: string, fn: () => Promise<void>): void;
declare function before(fn: () => Promise<void>): void;

/**
 * Bind a signer without losing the untyped contract methods ethers adds from the ABI.
 * `Contract.connect` is declared to return `BaseContract`.
 */
function bound(engine: Contract, signer: Signer): Contract {
  return engine.connect(signer) as Contract;
}

async function deploy(cap: number): Promise<Contract> {
  const engine = await ethers.deployContract("BidEngine", [cap]);
  await engine.waitForDeployment();
  return engine;
}

async function expectCustomError(tx: Promise<unknown>, errorName: string): Promise<void> {
  try {
    await tx;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes(errorName), message);
    return;
  }
  assert.fail(`expected ${errorName}`);
}

async function submitBid(engine: Contract, client: Client, signer: Signer, bps: bigint): Promise<void> {
  const engineAddress = await engine.getAddress();
  const [bid, proof] = await client
    .encryptInputs([Encryptable.uint32(bps)])
    .setConsumingContract(engineAddress)
    .execute();

  const tx = await bound(engine, signer).submitBid(bid, proof);
  await tx.wait();
}

async function expectLeader(engine: Contract, discountBps: bigint, winner: string, seated: boolean): Promise<void> {
  assert.equal(await engine.leaderRecorded(), true);
  await hre.cofhe.mocks.expectPlaintext(await engine.hasLeader(), seated ? 1n : 0n);
  await hre.cofhe.mocks.expectPlaintext(await engine.bestDiscount(), discountBps);
  await hre.cofhe.mocks.expectPlaintext(await engine.bestBidder(), BigInt(winner));
}

describe("BidEngine", function () {
  this.timeout(180_000);

  let alice: Signer;
  let bob: Signer;
  let carol: Signer;
  let stranger: Signer;
  let aliceAddr: string;
  let bobAddr: string;
  let carolAddr: string;
  let strangerAddr: string;
  let aliceClient: Client;
  let bobClient: Client;
  let carolClient: Client;
  let strangerClient: Client;

  before(async function () {
    const signers = await ethers.getSigners();
    alice = signers[0];
    bob = signers[1];
    carol = signers[2];
    stranger = signers[3];
    aliceAddr = await alice.getAddress();
    bobAddr = await bob.getAddress();
    carolAddr = await carol.getAddress();
    strangerAddr = await stranger.getAddress();

    // Sequential: each client signs its own self ACP.
    aliceClient = await hre.cofhe.createClientWithBatteries(signers[0]);
    bobClient = await hre.cofhe.createClientWithBatteries(signers[1]);
    carolClient = await hre.cofhe.createClientWithBatteries(signers[2]);
    strangerClient = await hre.cofhe.createClientWithBatteries(signers[3]);
  });

  it("rejects a cap above 10_000 and stores a legal cap with no setter", async function () {
    await expectCustomError(deploy(10_001), "CapAboveMax");

    const engine = await deploy(2_500);
    assert.equal(await engine.maxDiscountCap(), 2_500n);
    assert.equal(engine.interface.getFunction("setMaxDiscountCap"), null);
  });

  describe("winner selection", function () {
    it("seats the highest in-cap discount and ignores a lower one", async function () {
      const engine = await deploy(1_000);
      await bound(engine, alice).join();
      await bound(engine, bob).join();
      await bound(engine, carol).join();

      assert.equal(await engine.joinIndex(aliceAddr), 0n);
      assert.equal(await engine.joinIndex(bobAddr), 1n);
      assert.equal(await engine.memberAt(2n), carolAddr);

      // Bob bids first, and lower. Alice then takes the lead. Carol takes it from her.
      await submitBid(engine, bobClient, bob, 100n);
      await expectLeader(engine, 100n, bobAddr, true);

      await submitBid(engine, aliceClient, alice, 200n);
      await expectLeader(engine, 200n, aliceAddr, true);

      await submitBid(engine, carolClient, carol, 700n);
      await expectLeader(engine, 700n, carolAddr, true);
      assert.equal(await engine.submittedCount(), 3n);
    });

    it("does not seat an over-cap bid, and a later in-cap bid still can", async function () {
      const engine = await deploy(500);
      await bound(engine, alice).join();
      await bound(engine, bob).join();

      await submitBid(engine, aliceClient, alice, 501n);
      await expectLeader(engine, 0n, ethers.ZeroAddress, false);

      await submitBid(engine, bobClient, bob, 500n);
      await expectLeader(engine, 500n, bobAddr, true);
    });

    it("seats a discount of zero, which a strict comparison against an empty seat would drop", async function () {
      const engine = await deploy(0);
      await bound(engine, alice).join();
      await bound(engine, bob).join();

      await submitBid(engine, aliceClient, alice, 0n);
      await expectLeader(engine, 0n, aliceAddr, true);

      // Equal to the leader, so the earlier member stays. 1 bps is over a cap of 0.
      await submitBid(engine, bobClient, bob, 0n);
      await expectLeader(engine, 0n, aliceAddr, true);
    });

    it("reverts a second bid and a bid from an account that has not joined", async function () {
      const engine = await deploy(1_000);
      await bound(engine, alice).join();
      await expectCustomError(bound(engine, alice).join(), "AlreadyJoined");

      await submitBid(engine, aliceClient, alice, 10n);
      await expectCustomError(submitBid(engine, aliceClient, alice, 11n), "AlreadyBid");
      await expectCustomError(submitBid(engine, bobClient, bob, 12n), "NotMember");
    });
  });

  describe("ties", function () {
    it("gives the tie to the earlier-joined member even though they bid later", async function () {
      const engine = await deploy(1_000);
      await bound(engine, alice).join();
      await bound(engine, bob).join();
      await bound(engine, carol).join();

      // Bob is second. He bids the tying amount before Alice, who joined first.
      await submitBid(engine, bobClient, bob, 400n);
      await expectLeader(engine, 400n, bobAddr, true);

      await submitBid(engine, aliceClient, alice, 400n);
      await expectLeader(engine, 400n, aliceAddr, true);

      // Carol joined last and ties. She does not replace Alice.
      await submitBid(engine, carolClient, carol, 400n);
      await expectLeader(engine, 400n, aliceAddr, true);
    });

    it("ignores an earlier member who never bid and still breaks the tie by join order", async function () {
      const engine = await deploy(1_000);
      await bound(engine, alice).join();
      await bound(engine, bob).join();
      await bound(engine, carol).join();

      await submitBid(engine, carolClient, carol, 250n);
      await submitBid(engine, bobClient, bob, 250n);

      await expectLeader(engine, 250n, bobAddr, true);
      assert.equal(await engine.hasSubmitted(aliceAddr), false);
    });
  });

  describe("empty book", function () {
    it("records no leader when members have joined and nobody has bid", async function () {
      const engine = await deploy(1_000);
      await bound(engine, alice).join();
      await bound(engine, bob).join();

      assert.equal(await engine.memberCount(), 2n);
      assert.equal(await engine.submittedCount(), 0n);
      assert.equal(await engine.leaderRecorded(), false);
      assert.equal(await engine.bestDiscount(), ethers.ZeroHash);
      assert.equal(await engine.bestBidder(), ethers.ZeroHash);
      assert.equal(await engine.hasLeader(), ethers.ZeroHash);
      await expectCustomError(bound(engine, alice).myBid(), "NoBid");
    });
  });

  describe("losing bid privacy", function () {
    it("lets the bidder decrypt their own bid and nobody else", async function () {
      const engine = await deploy(1_000);
      const engineAddress = await engine.getAddress();
      await bound(engine, alice).join();
      await bound(engine, bob).join();

      // Alice loses. Bob wins. Both ciphertexts stay sealed to their owner.
      await submitBid(engine, aliceClient, alice, 150n);
      await submitBid(engine, bobClient, bob, 800n);
      await expectLeader(engine, 800n, bobAddr, true);

      const aliceBid = await bound(engine, alice).myBid();
      const bobBid = await bound(engine, bob).myBid();
      assert.notEqual(aliceBid, ethers.ZeroHash);
      assert.notEqual(bobBid, aliceBid);

      assert.equal(await aliceClient.decryptForView(aliceBid, FheTypes.Uint32).withACP().execute(), 150n);
      assert.equal(await bobClient.decryptForView(bobBid, FheTypes.Uint32).withACP().execute(), 800n);

      await expectSealDenied(bobClient, aliceBid);
      await expectSealDenied(carolClient, aliceBid);
      await expectSealDenied(strangerClient, aliceBid);
      await expectSealDenied(aliceClient, bobBid);
      await expectSealDenied(strangerClient, bobBid);

      await expectPublicDecryptDenied(strangerClient, aliceBid);
      await expectPublicDecryptDenied(bobClient, aliceBid);

      const acl = await hre.cofhe.mocks.getMockACL();
      assert.equal(await acl.persistAllowed(aliceBid, aliceAddr), true);
      assert.equal(await acl.persistAllowed(aliceBid, engineAddress), true);
      assert.equal(await acl.persistAllowed(aliceBid, bobAddr), false);
      assert.equal(await acl.persistAllowed(aliceBid, carolAddr), false);
      assert.equal(await acl.persistAllowed(aliceBid, strangerAddr), false);
      assert.equal(await acl.isAllowed(aliceBid, bobAddr), false);
      assert.equal(await acl.isAllowed(aliceBid, strangerAddr), false);
      assert.equal(await acl.globalAllowed(aliceBid), false);
      assert.equal(await acl.isAllowedForDecryption(aliceBid), false);
      assert.equal(await acl.globalAllowed(await engine.bestDiscount()), false);
      assert.equal(await acl.globalAllowed(await engine.bestBidder()), false);
    });
  });
});

async function expectSealDenied(client: Client, handle: string): Promise<void> {
  try {
    await client.decryptForView(handle, FheTypes.Uint32).withACP().execute();
  } catch (error) {
    assert.equal(isCofheError(error), true);
    if (!isCofheError(error)) return;
    assert.equal(error.code, CofheErrorCode.SealOutputFailed);
    assert.ok(error.message.includes("NotAllowed"), error.message);
    return;
  }
  assert.fail("decryptForView returned a bid the caller is not allowed to see");
}

async function expectPublicDecryptDenied(client: Client, handle: string): Promise<void> {
  try {
    await client.decryptForTx(handle).withoutACP().execute();
  } catch (error) {
    assert.equal(isCofheError(error), true);
    if (!isCofheError(error)) return;
    assert.equal(error.code, CofheErrorCode.DecryptFailed);
    assert.ok(error.message.includes("NotAllowed"), error.message);
    return;
  }
  assert.fail("decryptForTx without an ACP returned a private bid");
}
