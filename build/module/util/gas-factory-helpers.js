import { BigNumber } from '@ethersproject/bignumber';
import { Protocol } from '@uniswap/router-sdk';
import { ChainId, Percent, Token, TradeType } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import brotliPromise from 'brotli-wasm';
import JSBI from 'jsbi';
import _ from 'lodash';
import { getQuoteThroughNativePool, MixedRouteWithValidQuote, SwapType, usdGasTokensByChain, V2RouteWithValidQuote, V3RouteWithValidQuote, } from '../routers';
import { CurrencyAmount, log, WRAPPED_NATIVE_CURRENCY } from '../util';
import { estimateL1Gas, estimateL1GasCost } from '@eth-optimism/sdk';
import { opStackChains } from './l2FeeChains';
import { buildSwapMethodParameters, buildTrade } from './methodParameters';
export async function getV2NativePool(token, poolProvider, providerConfig) {
    const chainId = token.chainId;
    const weth = WRAPPED_NATIVE_CURRENCY[chainId];
    const poolAccessor = await poolProvider.getPools([[weth, token]], providerConfig);
    const pool = poolAccessor.getPool(weth, token);
    if (!pool || pool.reserve0.equalTo(0) || pool.reserve1.equalTo(0)) {
        log.error({
            weth,
            token,
            reserve0: pool === null || pool === void 0 ? void 0 : pool.reserve0.toExact(),
            reserve1: pool === null || pool === void 0 ? void 0 : pool.reserve1.toExact(),
        }, `Could not find a valid WETH V2 pool with ${token.symbol} for computing gas costs.`);
        return null;
    }
    return pool;
}
export async function getHighestLiquidityV3NativePool(token, poolProvider, providerConfig) {
    const nativeCurrency = WRAPPED_NATIVE_CURRENCY[token.chainId];
    const nativePools = _([
        FeeAmount.HIGH,
        FeeAmount.MEDIUM,
        FeeAmount.LOW,
        FeeAmount.LOWEST,
    ])
        .map((feeAmount) => {
        return [nativeCurrency, token, feeAmount];
    })
        .value();
    const poolAccessor = await poolProvider.getPools(nativePools, providerConfig);
    const pools = _([
        FeeAmount.HIGH,
        FeeAmount.MEDIUM,
        FeeAmount.LOW,
        FeeAmount.LOWEST,
    ])
        .map((feeAmount) => {
        return poolAccessor.getPool(nativeCurrency, token, feeAmount);
    })
        .compact()
        .value();
    if (pools.length == 0) {
        log.error({ pools }, `Could not find a ${nativeCurrency.symbol} pool with ${token.symbol} for computing gas costs.`);
        return null;
    }
    const maxPool = pools.reduce((prev, current) => {
        return JSBI.greaterThan(prev.liquidity, current.liquidity) ? prev : current;
    });
    return maxPool;
}
export async function getHighestLiquidityV3USDPool(chainId, poolProvider, providerConfig) {
    const usdTokens = usdGasTokensByChain[chainId];
    const wrappedCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
    if (!usdTokens) {
        throw new Error(`Could not find a USD token for computing gas costs on ${chainId}`);
    }
    const usdPools = _([
        FeeAmount.HIGH,
        FeeAmount.MEDIUM,
        FeeAmount.LOW,
        FeeAmount.LOWEST,
    ])
        .flatMap((feeAmount) => {
        return _.map(usdTokens, (usdToken) => [
            wrappedCurrency,
            usdToken,
            feeAmount,
        ]);
    })
        .value();
    const poolAccessor = await poolProvider.getPools(usdPools, providerConfig);
    const pools = _([
        FeeAmount.HIGH,
        FeeAmount.MEDIUM,
        FeeAmount.LOW,
        FeeAmount.LOWEST,
    ])
        .flatMap((feeAmount) => {
        const pools = [];
        for (const usdToken of usdTokens) {
            const pool = poolAccessor.getPool(wrappedCurrency, usdToken, feeAmount);
            if (pool) {
                pools.push(pool);
            }
        }
        return pools;
    })
        .compact()
        .value();
    if (pools.length == 0) {
        const message = `Could not find a USD/${wrappedCurrency.symbol} pool for computing gas costs.`;
        log.error({ pools }, message);
        throw new Error(message);
    }
    const maxPool = pools.reduce((prev, current) => {
        return JSBI.greaterThan(prev.liquidity, current.liquidity) ? prev : current;
    });
    return maxPool;
}
export function getGasCostInNativeCurrency(nativeCurrency, gasCostInWei) {
    // wrap fee to native currency
    const costNativeCurrency = CurrencyAmount.fromRawAmount(nativeCurrency, gasCostInWei.toString());
    return costNativeCurrency;
}
export async function getArbitrumBytes(data) {
    if (data == '')
        return BigNumber.from(0);
    const brotli = await brotliPromise;
    const compressed = brotli.compress(Buffer.from(data.replace('0x', ''), 'hex'), {
        quality: 1,
    });
    // TODO: This is a rough estimate of the compressed size
    // Brotli 0 should be used, but this brotli library doesn't support it
    // https://github.com/foliojs/brotli.js/issues/38
    // There are other brotli libraries that do support it, but require async
    // We workaround by using Brotli 1 with a 20% bump in size
    return BigNumber.from(compressed.length).mul(120).div(100);
}
export async function calculateArbitrumToL1FeeFromCalldata(calldata, gasData, chainId) {
    const { perL2TxFee, perL1CalldataFee, perArbGasTotal } = gasData;
    // calculates gas amounts based on bytes of calldata, use 0 as overhead.
    const l1GasUsed = await getL2ToL1GasUsed(calldata, chainId);
    // multiply by the fee per calldata and add the flat l2 fee
    const l1Fee = l1GasUsed.mul(perL1CalldataFee).add(perL2TxFee);
    const gasUsedL1OnL2 = l1Fee.div(perArbGasTotal);
    return [l1GasUsed, l1Fee, gasUsedL1OnL2];
}
export async function calculateOptimismToL1FeeFromCalldata(calldata, chainId, provider) {
    const tx = {
        data: calldata,
        chainId: chainId,
        type: 2, // sign the transaction as EIP-1559, otherwise it will fail at maxFeePerGas
    };
    const [l1GasUsed, l1GasCost] = await Promise.all([
        estimateL1Gas(provider, tx),
        estimateL1GasCost(provider, tx),
    ]);
    return [l1GasUsed, l1GasCost];
}
export async function getL2ToL1GasUsed(data, chainId) {
    switch (chainId) {
        case ChainId.ARBITRUM_ONE:
        case ChainId.ARBITRUM_GOERLI: {
            // calculates bytes of compressed calldata
            const l1ByteUsed = await getArbitrumBytes(data);
            return l1ByteUsed.mul(16);
        }
        default:
            return BigNumber.from(0);
    }
}
export async function calculateGasUsed(chainId, route, simulatedGasUsed, v2PoolProvider, v3PoolProvider, provider, providerConfig) {
    const quoteToken = route.quote.currency.wrapped;
    const gasPriceWei = route.gasPriceWei;
    // calculate L2 to L1 security fee if relevant
    let l2toL1FeeInWei = BigNumber.from(0);
    // Arbitrum charges L2 gas for L1 calldata posting costs.
    // See https://github.com/Uniswap/smart-order-router/pull/464/files#r1441376802
    if (opStackChains.includes(chainId)) {
        l2toL1FeeInWei = (await calculateOptimismToL1FeeFromCalldata(route.methodParameters.calldata, chainId, provider))[1];
    }
    // add l2 to l1 fee and wrap fee to native currency
    const gasCostInWei = gasPriceWei.mul(simulatedGasUsed).add(l2toL1FeeInWei);
    const nativeCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
    const costNativeCurrency = getGasCostInNativeCurrency(nativeCurrency, gasCostInWei);
    const usdPool = await getHighestLiquidityV3USDPool(chainId, v3PoolProvider, providerConfig);
    /** ------ MARK: USD logic  -------- */
    const gasCostUSD = getQuoteThroughNativePool(chainId, costNativeCurrency, usdPool);
    /** ------ MARK: Conditional logic run if gasToken is specified  -------- */
    let gasCostInTermsOfGasToken = undefined;
    if (providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.gasToken) {
        if (providerConfig.gasToken.equals(nativeCurrency)) {
            gasCostInTermsOfGasToken = costNativeCurrency;
        }
        else {
            const nativeAndSpecifiedGasTokenPool = await getHighestLiquidityV3NativePool(providerConfig.gasToken, v3PoolProvider, providerConfig);
            if (nativeAndSpecifiedGasTokenPool) {
                gasCostInTermsOfGasToken = getQuoteThroughNativePool(chainId, costNativeCurrency, nativeAndSpecifiedGasTokenPool);
            }
            else {
                log.info(`Could not find a V3 pool for gas token ${providerConfig.gasToken.symbol}`);
            }
        }
    }
    /** ------ MARK: Main gas logic in terms of quote token -------- */
    let gasCostQuoteToken = undefined;
    // shortcut if quote token is native currency
    if (quoteToken.equals(nativeCurrency)) {
        gasCostQuoteToken = costNativeCurrency;
    }
    // get fee in terms of quote token
    else {
        const nativePools = await Promise.all([
            getHighestLiquidityV3NativePool(quoteToken, v3PoolProvider, providerConfig),
            getV2NativePool(quoteToken, v2PoolProvider, providerConfig),
        ]);
        const nativePool = nativePools.find((pool) => pool !== null);
        if (!nativePool) {
            log.info('Could not find any V2 or V3 pools to convert the cost into the quote token');
            gasCostQuoteToken = CurrencyAmount.fromRawAmount(quoteToken, 0);
        }
        else {
            gasCostQuoteToken = getQuoteThroughNativePool(chainId, costNativeCurrency, nativePool);
        }
    }
    // Adjust quote for gas fees
    let quoteGasAdjusted;
    if (route.trade.tradeType == TradeType.EXACT_OUTPUT) {
        // Exact output - need more of tokenIn to get the desired amount of tokenOut
        quoteGasAdjusted = route.quote.add(gasCostQuoteToken);
    }
    else {
        // Exact input - can get less of tokenOut due to fees
        quoteGasAdjusted = route.quote.subtract(gasCostQuoteToken);
    }
    return {
        estimatedGasUsedUSD: gasCostUSD,
        estimatedGasUsedQuoteToken: gasCostQuoteToken,
        estimatedGasUsedGasToken: gasCostInTermsOfGasToken,
        quoteGasAdjusted: quoteGasAdjusted,
    };
}
export function initSwapRouteFromExisting(swapRoute, v2PoolProvider, v3PoolProvider, portionProvider, quoteGasAdjusted, estimatedGasUsed, estimatedGasUsedQuoteToken, estimatedGasUsedUSD, swapOptions, estimatedGasUsedGasToken) {
    const currencyIn = swapRoute.trade.inputAmount.currency;
    const currencyOut = swapRoute.trade.outputAmount.currency;
    const tradeType = swapRoute.trade.tradeType.valueOf()
        ? TradeType.EXACT_OUTPUT
        : TradeType.EXACT_INPUT;
    const routesWithValidQuote = swapRoute.route.map((route) => {
        switch (route.protocol) {
            case Protocol.V3:
                return new V3RouteWithValidQuote({
                    amount: CurrencyAmount.fromFractionalAmount(route.amount.currency, route.amount.numerator, route.amount.denominator),
                    rawQuote: BigNumber.from(route.rawQuote),
                    sqrtPriceX96AfterList: route.sqrtPriceX96AfterList.map((num) => BigNumber.from(num)),
                    initializedTicksCrossedList: [...route.initializedTicksCrossedList],
                    quoterGasEstimate: BigNumber.from(route.gasEstimate),
                    percent: route.percent,
                    route: route.route,
                    gasModel: route.gasModel,
                    quoteToken: new Token(currencyIn.chainId, route.quoteToken.address, route.quoteToken.decimals, route.quoteToken.symbol, route.quoteToken.name),
                    tradeType: tradeType,
                    v3PoolProvider: v3PoolProvider,
                });
            case Protocol.V2:
                return new V2RouteWithValidQuote({
                    amount: CurrencyAmount.fromFractionalAmount(route.amount.currency, route.amount.numerator, route.amount.denominator),
                    rawQuote: BigNumber.from(route.rawQuote),
                    percent: route.percent,
                    route: route.route,
                    gasModel: route.gasModel,
                    quoteToken: new Token(currencyIn.chainId, route.quoteToken.address, route.quoteToken.decimals, route.quoteToken.symbol, route.quoteToken.name),
                    tradeType: tradeType,
                    v2PoolProvider: v2PoolProvider,
                });
            case Protocol.MIXED:
                return new MixedRouteWithValidQuote({
                    amount: CurrencyAmount.fromFractionalAmount(route.amount.currency, route.amount.numerator, route.amount.denominator),
                    rawQuote: BigNumber.from(route.rawQuote),
                    sqrtPriceX96AfterList: route.sqrtPriceX96AfterList.map((num) => BigNumber.from(num)),
                    initializedTicksCrossedList: [...route.initializedTicksCrossedList],
                    quoterGasEstimate: BigNumber.from(route.gasEstimate),
                    percent: route.percent,
                    route: route.route,
                    mixedRouteGasModel: route.gasModel,
                    v2PoolProvider,
                    quoteToken: new Token(currencyIn.chainId, route.quoteToken.address, route.quoteToken.decimals, route.quoteToken.symbol, route.quoteToken.name),
                    tradeType: tradeType,
                    v3PoolProvider: v3PoolProvider,
                });
        }
    });
    const trade = buildTrade(currencyIn, currencyOut, tradeType, routesWithValidQuote);
    const quoteGasAndPortionAdjusted = swapRoute.portionAmount
        ? portionProvider.getQuoteGasAndPortionAdjusted(swapRoute.trade.tradeType, quoteGasAdjusted, swapRoute.portionAmount)
        : undefined;
    const routesWithValidQuotePortionAdjusted = portionProvider.getRouteWithQuotePortionAdjusted(swapRoute.trade.tradeType, routesWithValidQuote, swapOptions);
    return {
        quote: swapRoute.quote,
        quoteGasAdjusted,
        quoteGasAndPortionAdjusted,
        estimatedGasUsed,
        estimatedGasUsedQuoteToken,
        estimatedGasUsedGasToken,
        estimatedGasUsedUSD,
        gasPriceWei: BigNumber.from(swapRoute.gasPriceWei),
        trade,
        route: routesWithValidQuotePortionAdjusted,
        blockNumber: BigNumber.from(swapRoute.blockNumber),
        methodParameters: swapRoute.methodParameters
            ? {
                calldata: swapRoute.methodParameters.calldata,
                value: swapRoute.methodParameters.value,
                to: swapRoute.methodParameters.to,
            }
            : undefined,
        simulationStatus: swapRoute.simulationStatus,
        portionAmount: swapRoute.portionAmount,
    };
}
export const calculateL1GasFeesHelper = async (route, chainId, usdPool, quoteToken, nativePool, provider, l2GasData) => {
    const swapOptions = {
        type: SwapType.UNIVERSAL_ROUTER,
        recipient: '0x0000000000000000000000000000000000000001',
        deadlineOrPreviousBlockhash: 100,
        slippageTolerance: new Percent(5, 10000),
    };
    let mainnetGasUsed = BigNumber.from(0);
    let mainnetFeeInWei = BigNumber.from(0);
    let gasUsedL1OnL2 = BigNumber.from(0);
    if (opStackChains.includes(chainId)) {
        [mainnetGasUsed, mainnetFeeInWei] = await calculateOptimismToL1SecurityFee(route, swapOptions, chainId, provider);
    }
    else if (chainId == ChainId.ARBITRUM_ONE ||
        chainId == ChainId.ARBITRUM_GOERLI) {
        [mainnetGasUsed, mainnetFeeInWei, gasUsedL1OnL2] =
            await calculateArbitrumToL1SecurityFee(route, swapOptions, l2GasData, chainId);
    }
    // wrap fee to native currency
    const nativeCurrency = WRAPPED_NATIVE_CURRENCY[chainId];
    const costNativeCurrency = CurrencyAmount.fromRawAmount(nativeCurrency, mainnetFeeInWei.toString());
    // convert fee into usd
    const gasCostL1USD = getQuoteThroughNativePool(chainId, costNativeCurrency, usdPool);
    let gasCostL1QuoteToken = costNativeCurrency;
    // if the inputted token is not in the native currency, quote a native/quote token pool to get the gas cost in terms of the quote token
    if (!quoteToken.equals(nativeCurrency)) {
        if (!nativePool) {
            log.info('Could not find a pool to convert the cost into the quote token');
            gasCostL1QuoteToken = CurrencyAmount.fromRawAmount(quoteToken, 0);
        }
        else {
            const nativeTokenPrice = nativePool.token0.address == nativeCurrency.address
                ? nativePool.token0Price
                : nativePool.token1Price;
            gasCostL1QuoteToken = nativeTokenPrice.quote(costNativeCurrency);
        }
    }
    // gasUsedL1 is the gas units used calculated from the bytes of the calldata
    // gasCostL1USD and gasCostL1QuoteToken is the cost of gas in each of those tokens
    return {
        gasUsedL1: mainnetGasUsed,
        gasUsedL1OnL2,
        gasCostL1USD,
        gasCostL1QuoteToken,
    };
    /**
     * To avoid having a call to optimism's L1 security fee contract for every route and amount combination,
     * we replicate the gas cost accounting here.
     */
    async function calculateOptimismToL1SecurityFee(routes, swapConfig, chainId, provider) {
        const route = routes[0];
        const amountToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.amount.currency
            : route.quote.currency;
        const outputToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.quote.currency
            : route.amount.currency;
        // build trade for swap calldata
        const trade = buildTrade(amountToken, outputToken, route.tradeType, routes);
        const data = buildSwapMethodParameters(trade, swapConfig, ChainId.OPTIMISM).calldata;
        const [l1GasUsed, l1GasCost] = await calculateOptimismToL1FeeFromCalldata(data, chainId, provider);
        return [l1GasUsed, l1GasCost];
    }
    async function calculateArbitrumToL1SecurityFee(routes, swapConfig, gasData, chainId) {
        const route = routes[0];
        const amountToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.amount.currency
            : route.quote.currency;
        const outputToken = route.tradeType == TradeType.EXACT_INPUT
            ? route.quote.currency
            : route.amount.currency;
        // build trade for swap calldata
        const trade = buildTrade(amountToken, outputToken, route.tradeType, routes);
        const data = buildSwapMethodParameters(trade, swapConfig, ChainId.ARBITRUM_ONE).calldata;
        return await calculateArbitrumToL1FeeFromCalldata(data, gasData, chainId);
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2FzLWZhY3RvcnktaGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy91dGlsL2dhcy1mYWN0b3J5LWhlbHBlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLDBCQUEwQixDQUFDO0FBQ3JELE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQztBQUMvQyxPQUFPLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDdkUsT0FBTyxFQUFFLFNBQVMsRUFBUSxNQUFNLGlCQUFpQixDQUFDO0FBQ2xELE9BQU8sYUFBYSxNQUFNLGFBQWEsQ0FBQztBQUN4QyxPQUFPLElBQUksTUFBTSxNQUFNLENBQUM7QUFDeEIsT0FBTyxDQUFDLE1BQU0sUUFBUSxDQUFDO0FBTXZCLE9BQU8sRUFFTCx5QkFBeUIsRUFFekIsd0JBQXdCLEVBS3hCLFFBQVEsRUFDUixtQkFBbUIsRUFDbkIscUJBQXFCLEVBQ3JCLHFCQUFxQixHQUN0QixNQUFNLFlBQVksQ0FBQztBQUNwQixPQUFPLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSx1QkFBdUIsRUFBRSxNQUFNLFNBQVMsQ0FBQztBQUV2RSxPQUFPLEVBQUUsYUFBYSxFQUFFLGlCQUFpQixFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFHckUsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLGVBQWUsQ0FBQztBQUM5QyxPQUFPLEVBQUUseUJBQXlCLEVBQUUsVUFBVSxFQUFFLE1BQU0sb0JBQW9CLENBQUM7QUFFM0UsTUFBTSxDQUFDLEtBQUssVUFBVSxlQUFlLENBQ25DLEtBQVksRUFDWixZQUE2QixFQUM3QixjQUF1QztJQUV2QyxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBa0IsQ0FBQztJQUN6QyxNQUFNLElBQUksR0FBRyx1QkFBdUIsQ0FBQyxPQUFPLENB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