import http from 'http';
import https from 'https';
import { MaxUint256 } from '@ethersproject/constants';
import { ChainId } from '@uniswap/sdk-core';
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_ADDRESS, } from '@uniswap/universal-router-sdk';
import axios from 'axios';
import { BigNumber } from 'ethers/lib/ethers';
import { metric, MetricLoggerUnit, SwapType } from '../routers';
import { Erc20__factory } from '../types/other/factories/Erc20__factory';
import { Permit2__factory } from '../types/other/factories/Permit2__factory';
import { BEACON_CHAIN_DEPOSIT_ADDRESS, log, MAX_UINT160, SWAP_ROUTER_02_ADDRESSES, } from '../util';
import { APPROVE_TOKEN_FOR_TRANSFER } from '../util/callData';
import { calculateGasUsed, initSwapRouteFromExisting, } from '../util/gas-factory-helpers';
import { SimulationStatus, Simulator, } from './simulation-provider';
var TenderlySimulationType;
(function (TenderlySimulationType) {
    TenderlySimulationType["QUICK"] = "quick";
    TenderlySimulationType["FULL"] = "full";
    TenderlySimulationType["ABI"] = "abi";
})(TenderlySimulationType || (TenderlySimulationType = {}));
const TENDERLY_BATCH_SIMULATE_API = (tenderlyBaseUrl, tenderlyUser, tenderlyProject) => `${tenderlyBaseUrl}/api/v1/account/${tenderlyUser}/project/${tenderlyProject}/simulate-batch`;
// We multiply tenderly gas limit by this to overestimate gas limit
const DEFAULT_ESTIMATE_MULTIPLIER = 1.3;
export class FallbackTenderlySimulator extends Simulator {
    constructor(chainId, provider, portionProvider, tenderlySimulator, ethEstimateGasSimulator) {
        super(provider, portionProvider, chainId);
        this.tenderlySimulator = tenderlySimulator;
        this.ethEstimateGasSimulator = ethEstimateGasSimulator;
    }
    async simulateTransaction(fromAddress, swapOptions, swapRoute, providerConfig) {
        // Make call to eth estimate gas if possible
        // For erc20s, we must check if the token allowance is sufficient
        const inputAmount = swapRoute.trade.inputAmount;
        if ((inputAmount.currency.isNative && this.chainId == ChainId.MAINNET) ||
            (await this.checkTokenApproved(fromAddress, inputAmount, swapOptions, this.provider))) {
            log.info('Simulating with eth_estimateGas since token is native or approved.');
            try {
                const swapRouteWithGasEstimate = await this.ethEstimateGasSimulator.ethEstimateGas(fromAddress, swapOptions, swapRoute, providerConfig);
                return swapRouteWithGasEstimate;
            }
            catch (err) {
                log.info({ err: err }, 'Error simulating using eth_estimateGas');
                return { ...swapRoute, simulationStatus: SimulationStatus.Failed };
            }
        }
        try {
            return await this.tenderlySimulator.simulateTransaction(fromAddress, swapOptions, swapRoute, providerConfig);
        }
        catch (err) {
            log.error({ err: err }, 'Failed to simulate via Tenderly');
            if (err instanceof Error && err.message.includes('timeout')) {
                metric.putMetric('TenderlySimulationTimeouts', 1, MetricLoggerUnit.Count);
            }
            return { ...swapRoute, simulationStatus: SimulationStatus.Failed };
        }
    }
}
export class TenderlySimulator extends Simulator {
    constructor(chainId, tenderlyBaseUrl, tenderlyUser, tenderlyProject, tenderlyAccessKey, v2PoolProvider, v3PoolProvider, provider, portionProvider, overrideEstimateMultiplier, tenderlyRequestTimeout) {
        super(provider, portionProvider, chainId);
        this.tenderlyServiceInstance = axios.create({
            // keep connections alive,
            // maxSockets default is Infinity, so Infinity is read as 50 sockets
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true }),
        });
        this.tenderlyBaseUrl = tenderlyBaseUrl;
        this.tenderlyUser = tenderlyUser;
        this.tenderlyProject = tenderlyProject;
        this.tenderlyAccessKey = tenderlyAccessKey;
        this.v2PoolProvider = v2PoolProvider;
        this.v3PoolProvider = v3PoolProvider;
        this.overrideEstimateMultiplier = overrideEstimateMultiplier !== null && overrideEstimateMultiplier !== void 0 ? overrideEstimateMultiplier : {};
        this.tenderlyRequestTimeout = tenderlyRequestTimeout;
    }
    async simulateTransaction(fromAddress, swapOptions, swapRoute, providerConfig) {
        var _a;
        const currencyIn = swapRoute.trade.inputAmount.currency;
        const tokenIn = currencyIn.wrapped;
        const chainId = this.chainId;
        if ([ChainId.CELO, ChainId.CELO_ALFAJORES].includes(chainId)) {
            const msg = 'Celo not supported by Tenderly!';
            log.info(msg);
            return { ...swapRoute, simulationStatus: SimulationStatus.NotSupported };
        }
        if (!swapRoute.methodParameters) {
            const msg = 'No calldata provided to simulate transaction';
            log.info(msg);
            throw new Error(msg);
        }
        const { calldata } = swapRoute.methodParameters;
        log.info({
            calldata: swapRoute.methodParameters.calldata,
            fromAddress: fromAddress,
            chainId: chainId,
            tokenInAddress: tokenIn.address,
            router: swapOptions.type,
        }, 'Simulating transaction on Tenderly');
        const blockNumber = await (providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.blockNumber);
        let estimatedGasUsed;
        const estimateMultiplier = (_a = this.overrideEstimateMultiplier[chainId]) !== null && _a !== void 0 ? _a : DEFAULT_ESTIMATE_MULTIPLIER;
        if (swapOptions.type == SwapType.UNIVERSAL_ROUTER) {
            // simulating from beacon chain deposit address that should always hold **enough balance**
            if (currencyIn.isNative && this.chainId == ChainId.MAINNET) {
                fromAddress = BEACON_CHAIN_DEPOSIT_ADDRESS;
            }
            // Do initial onboarding approval of Permit2.
            const erc20Interface = Erc20__factory.createInterface();
            const approvePermit2Calldata = erc20Interface.encodeFunctionData('approve', [PERMIT2_ADDRESS, MaxUint256]);
            // We are unsure if the users calldata contains a permit or not. We just
            // max approve the Universal Router from Permit2 instead, which will cover both cases.
            const permit2Interface = Permit2__factory.createInterface();
            const approveUniversalRouterCallData = permit2Interface.encodeFunctionData('approve', [
                tokenIn.address,
                UNIVERSAL_ROUTER_ADDRESS(this.chainId),
                MAX_UINT160,
                Math.floor(new Date().getTime() / 1000) + 10000000,
            ]);
            const approvePermit2 = {
                network_id: chainId,
                estimate_gas: true,
                input: approvePermit2Calldata,
                to: tokenIn.address,
                value: '0',
                from: fromAddress,
                simulation_type: TenderlySimulationType.QUICK,
                save_if_fails: providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.saveTenderlySimulationIfFailed,
            };
            const approveUniversalRouter = {
                network_id: chainId,
                estimate_gas: true,
                input: approveUniversalRouterCallData,
                to: PERMIT2_ADDRESS,
                value: '0',
                from: fromAddress,
                simulation_type: TenderlySimulationType.QUICK,
                save_if_fails: providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.saveTenderlySimulationIfFailed,
            };
            const swap = {
                network_id: chainId,
                input: calldata,
                estimate_gas: true,
                to: UNIVERSAL_ROUTER_ADDRESS(this.chainId),
                value: currencyIn.isNative ? swapRoute.methodParameters.value : '0',
                from: fromAddress,
                block_number: blockNumber,
                simulation_type: TenderlySimulationType.QUICK,
                save_if_fails: providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.saveTenderlySimulationIfFailed,
            };
            const body = {
                simulations: [approvePermit2, approveUniversalRouter, swap],
                estimate_gas: true,
            };
            const opts = {
                headers: {
                    'X-Access-Key': this.tenderlyAccessKey,
                },
                timeout: this.tenderlyRequestTimeout,
            };
            const url = TENDERLY_BATCH_SIMULATE_API(this.tenderlyBaseUrl, this.tenderlyUser, this.tenderlyProject);
            metric.putMetric('TenderlySimulationUniversalRouterRequests', 1, MetricLoggerUnit.Count);
            const before = Date.now();
            const { data: resp, status: httpStatus } = await this.tenderlyServiceInstance
                .post(url, body, opts)
                .finally(() => {
                metric.putMetric('TenderlySimulationLatencies', Date.now() - before, MetricLoggerUnit.Milliseconds);
            });
            const latencies = Date.now() - before;
            log.info(`Tenderly simulation universal router request body: ${JSON.stringify(body, null, 2)}, having latencies ${latencies} in milliseconds.`);
            metric.putMetric('TenderlySimulationUniversalRouterLatencies', Date.now() - before, MetricLoggerUnit.Milliseconds);
            metric.putMetric(`TenderlySimulationUniversalRouterResponseStatus${httpStatus}`, 1, MetricLoggerUnit.Count);
            // Validate tenderly response body
            if (!resp ||
                resp.simulation_results.length < 3 ||
                !resp.simulation_results[2].transaction ||
                resp.simulation_results[2].transaction.error_message) {
                this.logTenderlyErrorResponse(resp);
                return { ...swapRoute, simulationStatus: SimulationStatus.Failed };
            }
            // Parse the gas used in the simulation response object, and then pad it so that we overestimate.
            estimatedGasUsed = BigNumber.from((resp.simulation_results[2].transaction.gas * estimateMultiplier).toFixed(0));
            log.info({
                body,
                approvePermit2GasUsed: resp.simulation_results[0].transaction.gas_used,
                approveUniversalRouterGasUsed: resp.simulation_results[1].transaction.gas_used,
                swapGasUsed: resp.simulation_results[2].transaction.gas_used,
                approvePermit2Gas: resp.simulation_results[0].transaction.gas,
                approveUniversalRouterGas: resp.simulation_results[1].transaction.gas,
                swapGas: resp.simulation_results[2].transaction.gas,
                swapWithMultiplier: estimatedGasUsed.toString(),
            }, 'Successfully Simulated Approvals + Swap via Tenderly for Universal Router. Gas used.');
            log.info({
                body,
                swapSimulation: resp.simulation_results[2].simulation,
                swapTransaction: resp.simulation_results[2].transaction,
            }, 'Successful Tenderly Swap Simulation for Universal Router');
        }
        else if (swapOptions.type == SwapType.SWAP_ROUTER_02) {
            const approve = {
                network_id: chainId,
                input: APPROVE_TOKEN_FOR_TRANSFER,
                estimate_gas: true,
                to: tokenIn.address,
                value: '0',
                from: fromAddress,
                simulation_type: TenderlySimulationType.QUICK,
            };
            const swap = {
                network_id: chainId,
                input: calldata,
                to: SWAP_ROUTER_02_ADDRESSES(chainId),
                estimate_gas: true,
                value: currencyIn.isNative ? swapRoute.methodParameters.value : '0',
                from: fromAddress,
                block_number: blockNumber,
                simulation_type: TenderlySimulationType.QUICK,
            };
            const body = { simulations: [approve, swap] };
            const opts = {
                headers: {
                    'X-Access-Key': this.tenderlyAccessKey,
                },
                timeout: this.tenderlyRequestTimeout,
            };
            const url = TENDERLY_BATCH_SIMULATE_API(this.tenderlyBaseUrl, this.tenderlyUser, this.tenderlyProject);
            metric.putMetric('TenderlySimulationSwapRouter02Requests', 1, MetricLoggerUnit.Count);
            const before = Date.now();
            const { data: resp, status: httpStatus } = await this.tenderlyServiceInstance.post(url, body, opts);
            metric.putMetric(`TenderlySimulationSwapRouter02ResponseStatus${httpStatus}`, 1, MetricLoggerUnit.Count);
            const latencies = Date.now() - before;
            log.info(`Tenderly simulation swap router02 request body: ${body}, having latencies ${latencies} in milliseconds.`);
            metric.putMetric('TenderlySimulationSwapRouter02Latencies', latencies, MetricLoggerUnit.Milliseconds);
            // Validate tenderly response body
            if (!resp ||
                resp.simulation_results.length < 2 ||
                !resp.simulation_results[1].transaction ||
                resp.simulation_results[1].transaction.error_message) {
                const msg = `Failed to Simulate Via Tenderly!: ${resp.simulation_results[1].transaction.error_message}`;
                log.info({ err: resp.simulation_results[1].transaction.error_message }, msg);
                return { ...swapRoute, simulationStatus: SimulationStatus.Failed };
            }
            // Parse the gas used in the simulation response object, and then pad it so that we overestimate.
            estimatedGasUsed = BigNumber.from((resp.simulation_results[1].transaction.gas * estimateMultiplier).toFixed(0));
            log.info({
                body,
                approveGasUsed: resp.simulation_results[0].transaction.gas_used,
                swapGasUsed: resp.simulation_results[1].transaction.gas_used,
                approveGas: resp.simulation_results[0].transaction.gas,
                swapGas: resp.simulation_results[1].transaction.gas,
                swapWithMultiplier: estimatedGasUsed.toString(),
            }, 'Successfully Simulated Approval + Swap via Tenderly for SwapRouter02. Gas used.');
            log.info({
                body,
                swapTransaction: resp.simulation_results[1].transaction,
                swapSimulation: resp.simulation_results[1].simulation,
            }, 'Successful Tenderly Swap Simulation for SwapRouter02');
        }
        else {
            throw new Error(`Unsupported swap type: ${swapOptions}`);
        }
        const { estimatedGasUsedUSD, estimatedGasUsedQuoteToken, estimatedGasUsedGasToken, quoteGasAdjusted, } = await calculateGasUsed(chainId, swapRoute, estimatedGasUsed, this.v2PoolProvider, this.v3PoolProvider, this.provider, providerConfig);
        return {
            ...initSwapRouteFromExisting(swapRoute, this.v2PoolProvider, this.v3PoolProvider, this.portionProvider, quoteGasAdjusted, estimatedGasUsed, estimatedGasUsedQuoteToken, estimatedGasUsedUSD, swapOptions, estimatedGasUsedGasToken),
            simulationStatus: SimulationStatus.Succeeded,
        };
    }
    logTenderlyErrorResponse(resp) {
        log.info({
            resp,
        }, 'Failed to Simulate on Tenderly');
        log.info({
            err: resp.simulation_results.length >= 1
                ? resp.simulation_results[0].transaction
                : {},
        }, 'Failed to Simulate on Tenderly #1 Transaction');
        log.info({
            err: resp.simulation_results.length >= 1
                ? resp.simulation_results[0].simulation
                : {},
        }, 'Failed to Simulate on Tenderly #1 Simulation');
        log.info({
            err: resp.simulation_results.length >= 2
                ? resp.simulation_results[1].transaction
                : {},
        }, 'Failed to Simulate on Tenderly #2 Transaction');
        log.info({
            err: resp.simulation_results.length >= 2
                ? resp.simulation_results[1].simulation
                : {},
        }, 'Failed to Simulate on Tenderly #2 Simulation');
        log.info({
            err: resp.simulation_results.length >= 3
                ? resp.simulation_results[2].transaction
                : {},
        }, 'Failed to Simulate on Tenderly #3 Transaction');
        log.info({
            err: resp.simulation_results.length >= 3
                ? resp.simulation_results[2].simulation
                : {},
        }, 'Failed to Simulate on Tenderly #3 Simulation');
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuZGVybHktc2ltdWxhdGlvbi1wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9wcm92aWRlcnMvdGVuZGVybHktc2ltdWxhdGlvbi1wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLElBQUksTUFBTSxNQUFNLENBQUM7QUFDeEIsT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBRTFCLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQztBQUV0RCxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDNUMsT0FBTyxFQUNMLGVBQWUsRUFDZix3QkFBd0IsR0FDekIsTUFBTSwrQkFBK0IsQ0FBQztBQUN2QyxPQUFPLEtBQTZCLE1BQU0sT0FBTyxDQUFDO0FBQ2xELE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUU5QyxPQUFPLEVBRUwsTUFBTSxFQUNOLGdCQUFnQixFQUdoQixRQUFRLEVBQ1QsTUFBTSxZQUFZLENBQUM7QUFDcEIsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLHlDQUF5QyxDQUFDO0FBQ3pFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLDJDQUEyQyxDQUFDO0FBQzdFLE9BQU8sRUFDTCw0QkFBNEIsRUFDNUIsR0FBRyxFQUNILFdBQVcsRUFDWCx3QkFBd0IsR0FDekIsTUFBTSxTQUFTLENBQUM7QUFDakIsT0FBTyxFQUFFLDBCQUEwQixFQUFFLE1BQU0sa0JBQWtCLENBQUM7QUFDOUQsT0FBTyxFQUNMLGdCQUFnQixFQUNoQix5QkFBeUIsR0FDMUIsTUFBTSw2QkFBNkIsQ0FBQztBQUlyQyxPQUFPLEVBRUwsZ0JBQWdCLEVBQ2hCLFNBQVMsR0FDVixNQUFNLHVCQUF1QixDQUFDO0FBc0IvQixJQUFLLHNCQUlKO0FBSkQsV0FBSyxzQkFBc0I7SUFDekIseUNBQWUsQ0FBQTtJQUNmLHVDQUFhLENBQUE7SUFD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