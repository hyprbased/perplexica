// src/lib/state_manager.ts

import Logger from '../utils/logger';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ReasoningState {
    queryId: string;
    startTime: Date;
    currentStep: number;
    totalSteps: number;
    status: 'initializing' | 'in_progress' | 'completed' | 'failed';
    partialResults: Map<string, any>;
    context: Map<string, any>;
    metadata: Record<string, any>;
}

interface StateSnapshot {
    timestamp: Date;
    state: ReasoningState;
    checkpointId: string;
}

export class StateManager extends EventEmitter {
    private logger: Logger;
    private activeStates: Map<string, ReasoningState>;
    private stateHistory: Map<string, StateSnapshot[]>;
    private persistencePath: string;
    private autoSaveInterval: NodeJS.Timeout;

    constructor(persistencePath: string = './state_storage') {
        super();
        this.logger = new Logger();
        this.activeStates = new Map();
        this.stateHistory = new Map();
        this.persistencePath = persistencePath;
        
        this.initializeStateManager();
        this.setupAutoSave();
    }

    private async initializeStateManager(): Promise<void> {
        try {
            await fs.mkdir(this.persistencePath, { recursive: true });
            await this.loadPersistedStates();
            this.logger.info('State manager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize state manager:', error);
            throw error;
        }
    }

    private setupAutoSave(): void {
        this.autoSaveInterval = setInterval(async () => {
            try {
                await this.persistAllStates();
                this.logger.debug('Auto-save completed successfully');
            } catch (error) {
                this.logger.error('Auto-save failed:', error);
            }
        }, 5 * 60 * 1000); // Auto-save every 5 minutes
    }

    async maintain_state(queryId: string, update: Partial<ReasoningState>): Promise<void> {
        try {
            let currentState = this.activeStates.get(queryId);

            if (!currentState) {
                currentState = {
                    queryId,
                    startTime: new Date(),
                    currentStep: 0,
                    totalSteps: 0,
                    status: 'initializing',
                    partialResults: new Map(),
                    context: new Map(),
                    metadata: {}
                };
                this.activeStates.set(queryId, currentState);
            }

            // Update state with new information
            Object.assign(currentState, update);

            // Create state snapshot
            const snapshot: StateSnapshot = {
                timestamp: new Date(),
                state: { ...currentState },
                checkpointId: `cp_${Date.now()}`
            };

            // Store snapshot in history
            if (!this.stateHistory.has(queryId)) {
                this.stateHistory.set(queryId, []);
            }
            this.stateHistory.get(queryId)?.push(snapshot);

            // Emit state update event
            this.emit('stateUpdated', queryId, currentState);

            await this.persistState(queryId);
        } catch (error) {
            this.logger.error(`Error maintaining state for query ${queryId}:`, error);
            throw error;
        }
    }

    async store_partial_results(queryId: string, stepId: string, results: any): Promise<void> {
        const state = this.activeStates.get(queryId);
        if (!state) {
            throw new Error(`No active state found for query ${queryId}`);
        }

        try {
            state.partialResults.set(stepId, results);
            state.currentStep++;

            // Create results file
            const resultsPath = path.join(this.persistencePath, queryId, 'partial_results');
            await fs.mkdir(resultsPath, { recursive: true });
            await fs.writeFile(
                path.join(resultsPath, `${stepId}.json`),
                JSON.stringify(results, null, 2)
            );

            this.emit('partialResultsStored', queryId, stepId, results);
        } catch (error) {
            this.logger.error(`Error storing partial results for query ${queryId}:`, error);
            throw error;
        }
    }

    async manage_context(queryId: string, contextKey: string, contextValue: any): Promise<void> {
        const state = this.activeStates.get(queryId);
        if (!state) {
            throw new Error(`No active state found for query ${queryId}`);
        }

        try {
            state.context.set(contextKey, contextValue);
            
            // Persist context update
            const contextPath = path.join(this.persistencePath, queryId, 'context');
            await fs.mkdir(contextPath, { recursive: true });
            await fs.writeFile(
                path.join(contextPath, `${contextKey}.json`),
                JSON.stringify(contextValue, null, 2)
            );

            this.emit('contextUpdated', queryId, contextKey, contextValue);
        } catch (error) {
            this.logger.error(`Error managing context for query ${queryId}:`, error);
            throw error;
        }
    }

    private async persistState(queryId: string): Promise<void> {
        const state = this.activeStates.get(queryId);
        if (!state) return;

        const statePath = path.join(this.persistencePath, queryId);
        try {
            await fs.mkdir(statePath, { recursive: true });
            await fs.writeFile(
                path.join(statePath, 'state.json'),
                JSON.stringify({
                    ...state,
                    partialResults: Array.from(state.partialResults.entries()),
                    context: Array.from(state.context.entries())
                }, null, 2)
            );
        } catch (error) {
            this.logger.error(`Error persisting state for query ${queryId}:`, error);
            throw error;
        }
    }

    private async persistAllStates(): Promise<void> {
        const persistPromises = Array.from(this.activeStates.keys()).map(queryId => 
            this.persistState(queryId)
        );
        await Promise.all(persistPromises);
    }

    private async loadPersistedStates(): Promise<void> {
        try {
            const directories = await fs.readdir(this.persistencePath);
            
            for (const queryId of directories) {
                const statePath = path.join(this.persistencePath, queryId, 'state.json');
                
                try {
                    const stateData = JSON.parse(await fs.readFile(statePath, 'utf-8'));
                    
                    // Reconstruct Maps from arrays
                    const state: ReasoningState = {
                        ...stateData,
                        partialResults: new Map(stateData.partialResults),
                        context: new Map(stateData.context)
                    };
                    
                    this.activeStates.set(queryId, state);
                } catch (error) {
                    this.logger.error(`Error loading state for query ${queryId}:`, error);
                }
            }
        } catch (error) {
            this.logger.error('Error loading persisted states:', error);
        }
    }

    async recoverState(queryId: string, checkpointId?: string): Promise<ReasoningState | null> {
        try {
            const snapshots = this.stateHistory.get(queryId);
            if (!snapshots) return null;

            let recoveredState: ReasoningState;
            
            if (checkpointId) {
                const snapshot = snapshots.find(s => s.checkpointId === checkpointId);
                if (!snapshot) return null;
                recoveredState = snapshot.state;
            } else {
                // Recover most recent state
                recoveredState = snapshots[snapshots.length - 1].state;
            }

            this.activeStates.set(queryId, recoveredState);
            this.emit('stateRecovered', queryId, recoveredState);
            
            return recoveredState;
        } catch (error) {
            this.logger.error(`Error recovering state for query ${queryId}:`, error);
            return null;
        }
    }

    getState(queryId: string): ReasoningState | undefined {
        return this.activeStates.get(queryId);
    }

    getStateHistory(queryId: string): StateSnapshot[] {
        return this.stateHistory.get(queryId) || [];
    }

    async cleanup(queryId: string): Promise<void> {
        this.activeStates.delete(queryId);
        this.stateHistory.delete(queryId);

        try {
            await fs.rm(path.join(this.persistencePath, queryId), { recursive: true, force: true });
        } catch (error) {
            this.logger.error(`Error cleaning up state for query ${queryId}:`, error);
        }
    }

    async dispose(): Promise<void> {
        clearInterval(this.autoSaveInterval);
        await this.persistAllStates();
    }
}

// Example usage:
/*
const stateManager = new StateManager('./state_storage');

// Initialize state for a new query
await stateManager.maintain_state('query1', {
    status: 'initializing',
    totalSteps: 5
});

// Store partial results
await stateManager.store_partial_results('query1', 'step1', {
    intermediate_data: 'some results'
});

// Manage context
await stateManager.manage_context('query1', 'user_preferences', {
    language: 'en',
    detail_level: 'high'
});

// Recover state if needed
const recoveredState = await stateManager.recoverState('query1');
*/
