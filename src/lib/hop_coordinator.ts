// src/lib/hop_coordinator.ts

import Logger from '../utils/logger';
import { EventEmitter } from 'events';
import { QueryDecomposer } from './query_decomposer';

interface Agent {
    id: string;
    name: string;
    capabilities: string[];
    status: 'idle' | 'busy' | 'error';
    load: number;
}

interface Query {
    id: string;
    text: string;
    priority: number;
    requiredCapabilities: string[];
    deadline?: Date;
}

interface ReasoningStep {
    id: string;
    queryId: string;
    agentId: string;
    startTime: Date;
    endTime?: Date;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    result?: any;
    error?: Error;
}

export class HopCoordinator extends EventEmitter {
    private logger: Logger;
    private agents: Map<string, Agent>;
    private activeQueries: Map<string, Query>;
    private reasoningSteps: Map<string, ReasoningStep>;
    private queryDecomposer: QueryDecomposer;

    constructor(ollamaEndpoint: string) {
        super();
        this.logger = new Logger();
        this.agents = new Map();
        this.activeQueries = new Map();
        this.reasoningSteps = new Map();
        this.queryDecomposer = new QueryDecomposer(ollamaEndpoint);

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.on('queryComplete', (queryId: string) => {
            this.logger.info(`Query ${queryId} completed`);
            this.cleanupQuery(queryId);
        });

        this.on('agentError', (agentId: string, error: Error) => {
            this.logger.error(`Agent ${agentId} encountered error:`, error);
            this.handleAgentError(agentId, error);
        });
    }

    async orchestrateReasoning(query: string): Promise<any> {
        const queryId = `q_${Date.now()}`;
        
        try {
            this.logger.info(`Starting reasoning orchestration for query: ${queryId}`);

            // Decompose the main query into sub-queries
            const subQueries = await this.queryDecomposer.decomposeQuery(query);
            
            // Get the execution plan
            const executionPlan = this.queryDecomposer.getExecutionPlan();
            
            // Process each layer of the execution plan
            for (const layer of executionPlan) {
                const layerPromises = layer.map(subQueryId => {
                    const subQuery = subQueries.find(sq => sq.id === subQueryId);
                    if (!subQuery) throw new Error(`SubQuery ${subQueryId} not found`);
                    return this.routeQuery({
                        id: subQueryId,
                        text: subQuery.text,
                        priority: 1,
                        requiredCapabilities: subQuery.toolsRequired
                    });
                });

                // Wait for all queries in the current layer to complete
                await Promise.all(layerPromises);
            }

            const finalResult = this.aggregateResults(queryId);
            this.emit('queryComplete', queryId);
            return finalResult;

        } catch (error) {
            this.logger.error(`Error in reasoning orchestration:`, error);
            throw error;
        }
    }

    async routeQuery(query: Query): Promise<any> {
        this.activeQueries.set(query.id, query);
        
        try {
            const selectedAgent = this.selectAgent(query.requiredCapabilities);
            if (!selectedAgent) {
                throw new Error(`No suitable agent found for query ${query.id}`);
            }

            const reasoningStep: ReasoningStep = {
                id: `step_${Date.now()}`,
                queryId: query.id,
                agentId: selectedAgent.id,
                startTime: new Date(),
                status: 'in_progress'
            };

            this.reasoningSteps.set(reasoningStep.id, reasoningStep);
            
            const result = await this.executeQuery(selectedAgent, query);
            
            reasoningStep.status = 'completed';
            reasoningStep.endTime = new Date();
            reasoningStep.result = result;
            
            return result;

        } catch (error) {
            this.logger.error(`Error routing query ${query.id}:`, error);
            throw error;
        }
    }

    private selectAgent(requiredCapabilities: string[]): Agent | null {
        const availableAgents = Array.from(this.agents.values())
            .filter(agent => 
                agent.status === 'idle' &&
                requiredCapabilities.every(cap => agent.capabilities.includes(cap))
            );

        if (availableAgents.length === 0) return null;

        // Select agent with lowest load
        return availableAgents.reduce((best, current) => 
            current.load < best.load ? current : best
        );
    }

    async manageAgentInteractions(fromAgentId: string, toAgentId: string, message: any): Promise<void> {
        const fromAgent = this.agents.get(fromAgentId);
        const toAgent = this.agents.get(toAgentId);

        if (!fromAgent || !toAgent) {
            throw new Error('Invalid agent IDs for interaction');
        }

        try {
            this.logger.info(`Managing interaction from ${fromAgentId} to ${toAgentId}`);
            
            // Validate message format and content
            this.validateAgentMessage(message);

            // Record the interaction
            this.recordAgentInteraction(fromAgentId, toAgentId, message);

            // Route the message to the target agent
            await this.sendMessageToAgent(toAgent, message);

        } catch (error) {
            this.logger.error(`Error in agent interaction:`, error);
            this.emit('agentError', fromAgentId, error);
        }
    }

    private async executeQuery(agent: Agent, query: Query): Promise<any> {
        try {
            agent.status = 'busy';
            agent.load += 1;

            // Simulate agent execution
            const result = await this.simulateAgentExecution(agent, query);

            agent.status = 'idle';
            agent.load -= 1;

            return result;

        } catch (error) {
            agent.status = 'error';
            throw error;
        }
    }

    private async simulateAgentExecution(agent: Agent, query: Query): Promise<any> {
        // This is a placeholder for actual agent execution logic
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({
                    agentId: agent.id,
                    queryId: query.id,
                    result: `Processed query: ${query.text}`
                });
            }, 1000);
        });
    }

    private validateAgentMessage(message: any): void {
        // Add message validation logic
        if (!message || typeof message !== 'object') {
            throw new Error('Invalid message format');
        }
    }

    private recordAgentInteraction(fromAgentId: string, toAgentId: string, message: any): void {
        // Add interaction recording logic
        this.logger.info('Agent interaction:', {
            from: fromAgentId,
            to: toAgentId,
            timestamp: new Date(),
            message
        });
    }

    private async sendMessageToAgent(agent: Agent, message: any): Promise<void> {
        // Add message sending logic
        this.logger.info(`Sending message to agent ${agent.id}`);
    }

    private aggregateResults(queryId: string): any {
        // Add result aggregation logic
        const relevantSteps = Array.from(this.reasoningSteps.values())
            .filter(step => step.queryId === queryId);

        return {
            queryId,
            steps: relevantSteps.map(step => ({
                stepId: step.id,
                result: step.result
            }))
        };
    }

    private cleanupQuery(queryId: string): void {
        this.activeQueries.delete(queryId);
        // Cleanup related resources
    }

    private handleAgentError(agentId: string, error: Error): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.status = 'error';
            agent.load = 0;
        }
    }

    // Public methods for agent management
    registerAgent(agent: Agent): void {
        this.agents.set(agent.id, agent);
        this.logger.info(`Agent registered: ${agent.id}`);
    }

    deregisterAgent(agentId: string): void {
        this.agents.delete(agentId);
        this.logger.info(`Agent deregistered: ${agentId}`);
    }

    getAgentStatus(agentId: string): Agent | undefined {
        return this.agents.get(agentId);
    }
}
