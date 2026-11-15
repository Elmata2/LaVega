import { brokerSyncCommitContract, brokerSyncLeaseContract } from "./brokerSyncLease.contract.js";
import { createMemoryBrokerSyncStateStore } from "./scheduledSync.js";

brokerSyncLeaseContract("memory broker sync", createMemoryBrokerSyncStateStore);
brokerSyncCommitContract("memory broker sync", createMemoryBrokerSyncStateStore);
