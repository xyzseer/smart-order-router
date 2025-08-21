"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.V3HeuristicGasModelFactory = void 0;
const bignumber_1 = require("@ethersproject/bignumber");
const sdk_core_1 = require("@uniswap/sdk-core");
const lodash_1 = __importDefault(require("lodash"));
const __1 = require("../../../..");
const amounts_1 = require("../../../../util/amounts");
const gas_factory_helpers_1 = require("../../../../util/gas-factory-helpers");
const log_1 = require("../../../../util/log");
const gas_model_1 = require("../gas-model");
const gas_costs_1 = require("./gas-costs");
/**
 * Computes a gas estimate for a V3 swap using heuristics.
 * Considers number of hops in the route, number of ticks crossed
 * and the typical base cost for a swap.
 *
 * We get the number of ticks crossed in a swap from the QuoterV2
 * contract.
 *
 * We compute gas estimates off-chain because
 *  1/ Calling eth_estimateGas for a swaps requires the caller to have
 *     the full balance token being swapped, and approvals.
 *  2/ Tracking gas used using a wrapper contract is not accurate with Multicall
 *     due to EIP-2929. We would have to make a request for every swap we wanted to estimate.
 *  3/ For V2 we simulate all our swaps off-chain so have no way to track gas used.
 *
 * @export
 * @class V3HeuristicGasModelFactory
 */
class V3HeuristicGasModelFactory extends gas_model_1.IOnChainGasModelFactory {
    constructor(provider) {
        super();
        this.provider = provider;
    }
    async buildGasModel({ chainId, gasPriceWei, pools, amountToken, quoteToken, l2GasDataProvider, providerConfig, }) {
        const l2GasData = l2GasDataProvider
            ? await l2GasDataProvider.getGasData(providerConfig)
            : undefined;
        const usdPool = pools.usdPool;
        const calculateL1GasFees = async (route) => {
            return await (0, gas_factory_helpers_1.calculateL1GasFeesHelper)(route, chainId, usdPool, quoteToken, pools.nativeAndQuoteTokenV3Pool, this.provider, l2GasData);
        };
        const nativeCurrency = __1.WRAPPED_NATIVE_CURRENCY[chainId];
        let nativeAmountPool = null;
        if (!amountToken.equals(nativeCurrency)) {
            nativeAmountPool = pools.nativeAndAmountTokenV3Pool;
        }
        const usdToken = usdPool.token0.equals(nativeCurrency)
            ? usdPool.token1
            : usdPool.token0;
        const estimateGasCost = (routeWithValidQuote) => {
            var _a;
            const { totalGasCostNativeCurrency, baseGasUse } = this.estimateGas(routeWithValidQuote, gasPriceWei, chainId, providerConfig);
            /** ------ MARK: USD logic  -------- */
            const gasCostInTermsOfUSD = (0, gas_model_1.getQuoteThroughNativePool)(chainId, totalGasCostNativeCurrency, usdPool);
            /** ------ MARK: Conditional logic run if gasToken is specified  -------- */
            const nativeAndSpecifiedGasTokenPool = pools.nativeAndSpecifiedGasTokenV3Pool;
            let gasCostInTermsOfGasToken = undefined;
            // we don't want to fetch the gasToken pool if the gasToken is the native currency
            if (nativeAndSpecifiedGasTokenPool) {
                gasCostInTermsOfGasToken = (0, gas_model_1.getQuoteThroughNativePool)(chainId, totalGasCostNativeCurrency, nativeAndSpecifiedGasTokenPool);
            }
            // if the gasToken is the native currency, we can just use the totalGasCostNativeCurrency
            else if ((_a = providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.gasToken) === null || _a === void 0 ? void 0 : _a.equals(nativeCurrency)) {
                gasCostInTermsOfGasToken = totalGasCostNativeCurrency;
            }
            /** ------ MARK: return early if quoteToken is wrapped native currency ------- */
            if (quoteToken.equals(nativeCurrency)) {
                return {
                    gasEstimate: baseGasUse,
                    gasCostInToken: totalGasCostNativeCurrency,
                    gasCostInUSD: gasCostInTermsOfUSD,
                    gasCostInGasToken: gasCostInTermsOfGasToken,
                };
            }
            /** ------ MARK: Main gas logic in terms of quote token -------- */
            // Since the quote token is not in the native currency, we convert the gas cost to be in terms of the quote token.
            // We do this by getting the highest liquidity <quoteToken>/<nativeCurrency> pool. eg. <quoteToken>/ETH pool.
            const nativeAndQuoteTokenPool = pools.nativeAndQuoteTokenV3Pool;
            let gasCostInTermsOfQuoteToken = null;
            if (nativeAndQuoteTokenPool) {
                gasCostInTermsOfQuoteToken = (0, gas_model_1.getQuoteThroughNativePool)(chainId, totalGasCostNativeCurrency, nativeAndQuoteTokenPool);
            }
            // We may have a nativeAmountPool, but not a nativePool
            else {
                log_1.log.info(`Unable to find ${nativeCurrency.symbol} pool with the quote token, ${quoteToken.symbol} to produce gas adjusted costs. Using amountToken to calculate gas costs.`);
            }
            /** ------ MARK: (V3 ONLY) Logic for calculating synthetic gas cost in terms of amount token -------- */
            // TODO: evaluate effectiveness and potentially refactor
            // Highest liquidity pool for the non quote token / ETH
            // A pool with the non quote token / ETH should not be required and errors should be handled separately
            if (nativeAmountPool) {
                // get current execution price (amountToken / quoteToken)
                const executionPrice = new sdk_core_1.Price(routeWithValidQuote.amount.currency, routeWithValidQuote.quote.currency, routeWithValidQuote.amount.quotient, routeWithValidQuote.quote.quotient);
                const inputIsToken0 = nativeAmountPool.token0.address == nativeCurrency.address;
                // ratio of input / native
                const nativeAndAmountTokenPrice = inputIsToken0
                    ? nativeAmountPool.token0Price
                    : nativeAmountPool.token1Price;
                const gasCostInTermsOfAmountToken = nativeAndAmountTokenPrice.quote(totalGasCostNativeCurrency);
                // Convert gasCostInTermsOfAmountToken to quote token using execution price
                const syntheticGasCostInTermsOfQuoteToken = executionPrice.quote(gasCostInTermsOfAmountToken);
                // Note that the syntheticGasCost being lessThan the original quoted value is not always strictly better
                // e.g. the scenario where the amountToken/ETH pool is very illiquid as well and returns an extremely small number
                // however, it is better to have the gasEstimation be almost 0 than almost infinity, as the user will still receive a quote
                if (gasCostInTermsOfQuoteToken === null ||
                    syntheticGasCostInTermsOfQuoteToken.lessThan(gasCostInTermsOfQuoteToken.asFraction)) {
                    log_1.log.info({
                        nativeAndAmountTokenPrice: nativeAndAmountTokenPrice.toSignificant(6),
                        gasCostInTermsOfQuoteToken: gasCostInTermsOfQuoteToken
                            ? gasCostInTermsOfQuoteToken.toExact()
                            : 0,
                        gasCostInTermsOfAmountToken: gasCostInTermsOfAmountToken.toExact(),
                        executionPrice: executionPrice.toSignificant(6),
                        syntheticGasCostInTermsOfQuoteToken: syntheticGasCostInTermsOfQuoteToken.toSignificant(6),
                    }, 'New gasCostInTermsOfQuoteToken calculated with synthetic quote token price is less than original');
                    gasCostInTermsOfQuoteToken = syntheticGasCostInTermsOfQuoteToken;
                }
            }
            // If gasCostInTermsOfQuoteToken is null, both attempts to calculate gasCostInTermsOfQuoteToken failed (nativePool and amountNativePool)
            if (gasCostInTermsOfQuoteToken === null) {
                log_1.log.info(`Unable to find ${nativeCurrency.symbol} pool with the quote token, ${quoteToken.symbol}, or amount Token, ${amountToken.symbol} to produce gas adjusted costs. Route will not account for gas.`);
                return {
                    gasEstimate: baseGasUse,
                    gasCostInToken: amounts_1.CurrencyAmount.fromRawAmount(quoteToken, 0),
                    gasCostInUSD: amounts_1.CurrencyAmount.fromRawAmount(usdToken, 0),
                };
            }
            return {
                gasEstimate: baseGasUse,
                gasCostInToken: gasCostInTermsOfQuoteToken,
                gasCostInUSD: gasCostInTermsOfUSD,
                gasCostInGasToken: gasCostInTermsOfGasToken,
            };
        };
        return {
            estimateGasCost: estimateGasCost.bind(this),
            calculateL1GasFees,
        };
    }
    estimateGas(routeWithValidQuote, gasPriceWei, chainId, providerConfig) {
        var _a;
        const totalInitializedTicksCrossed = bignumber_1.BigNumber.from(Math.max(1, lodash_1.default.sum(routeWithValidQuote.initializedTicksCrossedList)));
        const totalHops = bignumber_1.BigNumber.from(routeWithValidQuote.route.pools.length);
        let hopsGasUse = (0, gas_costs_1.COST_PER_HOP)(chainId).mul(totalHops);
        // We have observed that this algorithm tends to underestimate single hop swaps.
        // We add a buffer in the case of a single hop swap.
        if (totalHops.eq(1)) {
            hopsGasUse = hopsGasUse.add((0, gas_costs_1.SINGLE_HOP_OVERHEAD)(chainId));
        }
        // Some tokens have extremely expensive transferFrom functions, which causes
        // us to underestimate them by a large amount. For known tokens, we apply an
        // adjustment.
        const tokenOverhead = (0, gas_costs_1.TOKEN_OVERHEAD)(chainId, routeWithValidQuote.route);
        const tickGasUse = (0, gas_costs_1.COST_PER_INIT_TICK)(chainId).mul(totalInitializedTicksCrossed);
        const uninitializedTickGasUse = gas_costs_1.COST_PER_UNINIT_TICK.mul(0);
        // base estimate gas used based on chainId estimates for hops and ticks gas useage
        const baseGasUse = (0, gas_costs_1.BASE_SWAP_COST)(chainId)
            .add(hopsGasUse)
            .add(tokenOverhead)
            .add(tickGasUse)
            .add(uninitializedTickGasUse)
            .add((_a = providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.additionalGasOverhead) !== null && _a !== void 0 ? _a : bignumber_1.BigNumber.from(0));
        const baseGasCostWei = gasPriceWei.mul(baseGasUse);
        const wrappedCurrency = __1.WRAPPED_NATIVE_CURRENCY[chainId];
        const totalGasCostNativeCurrency = amounts_1.CurrencyAmount.fromRawAmount(wrappedCurrency, baseGasCostWei.toString());
        return {
            totalGasCostNativeCurrency,
            totalInitializedTicksCrossed,
            baseGasUse,
        };
    }
}
exports.V3HeuristicGasModelFactory = V3HeuristicGasModelFactory;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidjMtaGV1cmlzdGljLWdhcy1tb2RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2FscGhhLXJvdXRlci9nYXMtbW9kZWxzL3YzL3YzLWhldXJpc3RpYy1nYXMtbW9kZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsd0RBQXFEO0FBQ3JELGdEQUFtRDtBQUVuRCxvREFBdUI7QUFFdkIsbUNBQXNEO0FBQ3RELHNEQUEwRDtBQUMxRCw4RUFBZ0Y7QUFDaEYsOENBQTJDO0FBRTNDLDRDQU1zQjtBQUV0QiwyQ0FPcUI7QUFHckI7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsTUFBYSwwQkFBMkIsU0FBUSxtQ0FBdUI7SUFHckUsWUFBWSxRQUFzQjtRQUNoQyxLQUFLLEVBQUUsQ0FBQztRQUNSLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzNCLENBQUM7SUFFTSxLQUFLLENBQUMsYUFBYSxDQUFDLEVBQ3pCLE9BQU8sRUFDUCxXQUFXLEVBQ1gsS0FBSyxFQUNMLFdBQVcsRUFDWCxVQUFVLEVBQ1YsaUJBQWlCLEVBQ2pCLGNBQWMsR0FDa0I7UUFHaEMsTUFBTSxTQUFTLEdBQUcsaUJBQWlCO1lBQ2pDLENBQUMsQ0FBQyxNQUFNLGlCQUFpQixDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUM7WUFDcEQsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUVkLE1BQU0sT0FBTyxHQUFTLEtBQUssQ0FBQyxPQUFPLENBQUM7UUFFcEMsTUFBTSxrQkFBa0IsR0FBRyxLQUFLLEVBQzlCLEtBQThCLEVBTTdCLEVBQUU7WUFDSCxPQUFPLE1BQU0sSUFBQSw4Q0FBd0IsRUFDbkMsS0FBSyxFQUNMLE9BQU8sRUFDUCxPQUFPLEVBQ1AsVUFBVSxFQUNWLEtBQUssQ0FBQyx5QkFBeUIsRUFDL0IsSUFBSSxDQUFDLFFBQVEsRUFDYixTQUFTLENBQ1YsQ0FBQztRQUNKLENBQUMsQ0FBQztRQUVG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