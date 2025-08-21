"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMixedRouteCandidatePools = exports.getV2CandidatePools = exports.getV3CandidatePools = void 0;
const router_sdk_1 = require("@uniswap/router-sdk");
const sdk_core_1 = require("@uniswap/sdk-core");
const v3_sdk_1 = require("@uniswap/v3-sdk");
const lodash_1 = __importDefault(require("lodash"));
const providers_1 = require("../../../providers");
const token_provider_1 = require("../../../providers/token-provider");
const util_1 = require("../../../util");
const amounts_1 = require("../../../util/amounts");
const log_1 = require("../../../util/log");
const metric_1 = require("../../../util/metric");
const baseTokensByChain = {
    [sdk_core_1.ChainId.MAINNET]: [
        token_provider_1.USDC_MAINNET,
        token_provider_1.USDT_MAINNET,
        token_provider_1.WBTC_MAINNET,
        token_provider_1.DAI_MAINNET,
        util_1.WRAPPED_NATIVE_CURRENCY[1],
        token_provider_1.FEI_MAINNET,
    ],
    [sdk_core_1.ChainId.OPTIMISM]: [
        token_provider_1.DAI_OPTIMISM,
        token_provider_1.USDC_OPTIMISM,
        token_provider_1.USDT_OPTIMISM,
        token_provider_1.WBTC_OPTIMISM,
    ],
    [sdk_core_1.ChainId.SEPOLIA]: [token_provider_1.DAI_SEPOLIA, token_provider_1.USDC_SEPOLIA],
    [sdk_core_1.ChainId.OPTIMISM_GOERLI]: [
        token_provider_1.DAI_OPTIMISM_GOERLI,
        token_provider_1.USDC_OPTIMISM_GOERLI,
        token_provider_1.USDT_OPTIMISM_GOERLI,
        token_provider_1.WBTC_OPTIMISM_GOERLI,
    ],
    [sdk_core_1.ChainId.OPTIMISM_SEPOLIA]: [
        providers_1.DAI_OPTIMISM_SEPOLIA,
        providers_1.USDC_OPTIMISM_SEPOLIA,
        providers_1.USDT_OPTIMISM_SEPOLIA,
        providers_1.WBTC_OPTIMISM_SEPOLIA,
    ],
    [sdk_core_1.ChainId.ARBITRUM_ONE]: [
        token_provider_1.DAI_ARBITRUM,
        token_provider_1.USDC_ARBITRUM,
        token_provider_1.WBTC_ARBITRUM,
        token_provider_1.USDT_ARBITRUM,
    ],
    [sdk_core_1.ChainId.ARBITRUM_GOERLI]: [token_provider_1.USDC_ARBITRUM_GOERLI],
    [sdk_core_1.ChainId.ARBITRUM_SEPOLIA]: [providers_1.USDC_ARBITRUM_SEPOLIA],
    [sdk_core_1.ChainId.POLYGON]: [token_provider_1.USDC_POLYGON, token_provider_1.WMATIC_POLYGON],
    [sdk_core_1.ChainId.POLYGON_MUMBAI]: [token_provider_1.DAI_POLYGON_MUMBAI, token_provider_1.WMATIC_POLYGON_MUMBAI],
    [sdk_core_1.ChainId.CELO]: [token_provider_1.CUSD_CELO, token_provider_1.CEUR_CELO, token_provider_1.CELO],
    [sdk_core_1.ChainId.CELO_ALFAJORES]: [
        token_provider_1.CUSD_CELO_ALFAJORES,
        token_provider_1.CEUR_CELO_ALFAJORES,
        token_provider_1.CELO_ALFAJORES,
    ],
    [sdk_core_1.ChainId.GNOSIS]: [token_provider_1.WBTC_GNOSIS, token_provider_1.WXDAI_GNOSIS, token_provider_1.USDC_ETHEREUM_GNOSIS],
    [sdk_core_1.ChainId.MOONBEAM]: [
        token_provider_1.DAI_MOONBEAM,
        token_provider_1.USDC_MOONBEAM,
        token_provider_1.WBTC_MOONBEAM,
        token_provider_1.WGLMR_MOONBEAM,
    ],
    [sdk_core_1.ChainId.BNB]: [token_provider_1.DAI_BNB, token_provider_1.USDC_BNB, token_provider_1.USDT_BNB],
    [sdk_core_1.ChainId.AVALANCHE]: [token_provider_1.DAI_AVAX, token_provider_1.USDC_AVAX],
    [sdk_core_1.ChainId.BASE]: [token_provider_1.USDC_BASE],
    [sdk_core_1.ChainId.BLAST]: [util_1.WRAPPED_NATIVE_CURRENCY[sdk_core_1.ChainId.BLAST], token_provider_1.USDB_BLAST],
};
class SubcategorySelectionPools {
    constructor(pools, poolsNeeded) {
        this.pools = pools;
        this.poolsNeeded = poolsNeeded;
    }
    hasEnoughPools() {
        return this.pools.length >= this.poolsNeeded;
    }
}
async function getV3CandidatePools({ tokenIn, tokenOut, routeType, routingConfig, subgraphProvider, tokenProvider, poolProvider, blockedTokenListProvider, chainId, }) {
    var _a, _b, _c, _d, _e;
    const { blockNumber, v3PoolSelection: { topN, topNDirectSwaps, topNTokenInOut, topNSecondHop, topNSecondHopForTokenAddress, tokensToAvoidOnSecondHops, topNWithEachBaseToken, topNWithBaseToken, }, } = routingConfig;
    const tokenInAddress = tokenIn.address.toLowerCase();
    const tokenOutAddress = tokenOut.address.toLowerCase();
    const beforeSubgraphPools = Date.now();
    const allPools = await subgraphProvider.getPools(tokenIn, tokenOut, {
        blockNumber,
    });
    log_1.log.info({ samplePools: allPools.slice(0, 3) }, 'Got all pools from V3 subgraph provider');
    // Although this is less of an optimization than the V2 equivalent,
    // save some time copying objects by mutating the underlying pool directly.
    for (const pool of allPools) {
        pool.token0.id = pool.token0.id.toLowerCase();
        pool.token1.id = pool.token1.id.toLowerCase();
    }
    metric_1.metric.putMetric('V3SubgraphPoolsLoad', Date.now() - beforeSubgraphPools, metric_1.MetricLoggerUnit.Milliseconds);
    const beforePoolsFiltered = Date.now();
    // Only consider pools where neither tokens are in the blocked token list.
    let filteredPools = allPools;
    if (blockedTokenListProvider) {
        filteredPools = [];
        for (const pool of allPools) {
            const token0InBlocklist = await blockedTokenListProvider.hasTokenByAddress(pool.token0.id);
            const token1InBlocklist = await blockedTokenListProvider.hasTokenByAddress(pool.token1.id);
            if (token0InBlocklist || token1InBlocklist) {
                continue;
            }
            filteredPools.push(pool);
        }
    }
    // Sort by tvlUSD in descending order
    const subgraphPoolsSorted = filteredPools.sort((a, b) => b.tvlUSD - a.tvlUSD);
    log_1.log.info(`After filtering blocked tokens went from ${allPools.length} to ${subgraphPoolsSorted.length}.`);
    const poolAddressesSoFar = new Set();
    const addToAddressSet = (pools) => {
        (0, lodash_1.default)(pools)
            .map((pool) => pool.id)
            .forEach((poolAddress) => poolAddressesSoFar.add(poolAddress));
    };
    const baseTokens = (_a = baseTokensByChain[chainId]) !== null && _a !== void 0 ? _a : [];
    const topByBaseWithTokenIn = (0, lodash_1.default)(baseTokens)
        .flatMap((token) => {
        return (0, lodash_1.default)(subgraphPoolsSorted)
            .filter((subgraphPool) => {
            const tokenAddress = token.address.toLowerCase();
            return ((subgraphPool.token0.id == tokenAddress &&
                subgraphPool.token1.id == tokenInAddress) ||
                (subgraphPool.token1.id == tokenAddress &&
                    subgraphPool.token0.id == tokenInAddress));
        })
            .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
            .slice(0, topNWithEachBaseToken)
            .value();
    })
        .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
        .slice(0, topNWithBaseToken)
        .value();
    const topByBaseWithTokenOut = (0, lodash_1.default)(baseTokens)
        .flatMap((token) => {
        return (0, lodash_1.default)(subgraphPoolsSorted)
            .filter((subgraphPool) => {
            const tokenAddress = token.address.toLowerCase();
            return ((subgraphPool.token0.id == tokenAddress &&
                subgraphPool.token1.id == tokenOutAddress) ||
                (subgraphPool.token1.id == tokenAddress &&
                    subgraphPool.token0.id == tokenOutAddress));
        })
            .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
            .slice(0, topNWithEachBaseToken)
            .value();
    })
        .sortBy((tokenListPool) => -tokenListPool.tvlUSD)
        .slice(0, topNWithBaseToken)
        .value();
    let top2DirectSwapPool = (0, lodash_1.default)(subgraphPoolsSorted)
        .filter((subgraphPool) => {
        return (!poolAddressesSoFar.has(subgraphPool.id) &&
            ((subgraphPool.token0.id == tokenInAddress &&
                subgraphPool.token1.id == tokenOutAddress) ||
                (subgraphPool.token1.id == tokenInAddress &&
                    subgraphPool.token0.id == tokenOutAddress)));
    })
        .slice(0, topNDirectSwaps)
        .value();
    if (top2DirectSwapPool.length == 0 && topNDirectSwaps > 0) {
        // If we requested direct swap pools but did not find any in the subgraph query.
        // Optimistically add them into the query regardless. Invalid pools ones will be dropped anyway
        // when we query the pool on-chain. Ensures that new pools for new pairs can be swapped on immediately.
        top2DirectSwapPool = lodash_1.default.map([v3_sdk_1.FeeAmount.HIGH, v3_sdk_1.FeeAmount.MEDIUM, v3_sdk_1.FeeAmount.LOW, v3_sdk_1.FeeAmount.LOWEST], (feeAmount) => {
            const { token0, token1, poolAddress } = poolProvider.getPoolAddress(tokenIn, tokenOut, feeAmount);
            return {
                id: poolAddress,
                feeTier: (0, util_1.unparseFeeAmount)(feeAmount),
                liquidity: '10000',
                token0: {
                    id: token0.address,
                },
                token1: {
                    id: token1.address,
                },
                tvlETH: 10000,
                tvlUSD: 10000,
            };
        });
    }
    addToAddressSet(top2DirectSwapPool);
    const wrappedNativeAddress = (_b = util_1.WRAPPED_NATIVE_CURRENCY[chainId]) === null || _b === void 0 ? void 0 : _b.address.toLowerCase();
    // Main reason we need this is for gas estimates, only needed if token out is not native.
    // We don't check the seen address set because if we've already added pools for getting native quotes
    // theres no need to add more.
    let top2EthQuoteTokenPool = [];
    if ((((_c = util_1.WRAPPED_NATIVE_CURRENCY[chainId]) === null || _c === void 0 ? void 0 : _c.symbol) ==
        ((_d = util_1.WRAPPED_NATIVE_CURRENCY[sdk_core_1.ChainId.MAINNET]) === null || _d === void 0 ? void 0 : _d.symbol) &&
        tokenOut.symbol != 'WETH' &&
        tokenOut.symbol != 'WETH9' &&
        tokenOut.symbol != 'ETH') ||
        (((_e = util_1.WRAPPED_NATIVE_CURRENCY[chainId]) === null || _e === void 0 ? void 0 : _e.symbol) == token_provider_1.WMATIC_POLYGON.symbol &&
            tokenOut.symbol != 'MATIC' &&
            tokenOut.symbol != 'WMATIC')) {
        top2EthQuoteTokenPool = (0, lodash_1.default)(subgraphPoolsSorted)
            .filter((subgraphPool) => {
            if (routeType == sdk_core_1.TradeType.EXACT_INPUT) {
                return ((subgraphPool.token0.id == wrappedNativeAddress &&
                    subgraphPool.token1.id == tokenOutAddress) ||
                    (subgraphPool.token1.id == wrappedNativeAddress &&
                        subgraphPool.token0.id == tokenOutAddress));
            }
            else {
                return ((subgraphPool.token0.id == wrappedNativeAddress &&
                    subgraphPool.token1.id == tokenInAddress) ||
                    (subgraphPool.token1.id == wrappedNativeAddress &&
                        subgraphPool.token0.id == tokenInAddress));
            }
        })
            .slice(0, 1)
            .value();
    }
    addToAddressSet(top2EthQuoteTokenPool);
    const topByTVL = (0, lodash_1.default)(subgraphPoolsSorted)
        .filter((subgraphPool) => {
        return !poolAddressesSoFar.has(subgraphPool.id);
    })
        .slice(0, topN)
        .value();
    addToAddressSet(topByTVL);
    const topByTVLUsingTokenIn = (0, lodash_1.default)(subgraphPoolsSorted)
        .filter((subgraphPool) => {
        return (!poolAddressesSoFar.has(subgraphPool.id) &&
            (subgraphPool.token0.id == tokenInAddress ||
                subgraphPool.token1.id == tokenInAddress));
    })
        .slice(0, topNTokenInOut)
        .value();
    addToAddressSet(topByTVLUsingTokenIn);
    const topByTVLUsingTokenOut = (0, lodash_1.default)(subgraphPoolsSorted)
        .filter((subgraphPool) => {
        return (!poolAddressesSoFar.has(subgraphPool.id) &&
            (subgraphPool.token0.id == tokenOutAddress ||
                subgraphPool.token1.id == tokenOutAddress));
    })
        .slice(0, topNTokenInOut)
        .value();
    addToAddressSet(topByTVLUsingTokenOut);
    const topByTVLUsingTokenInSecondHops = (0, lodash_1.default)(topByTVLUsingTokenIn)
        .map((subgraphPool) => {
        return tokenInAddress == subgraphPool.token0.id
            ? subgraphPool.token1.id
            : subgraphPool.token0.id;
    })
        .flatMap((secondHopId) => {
        var _a;
        return (0, lodash_1.default)(subgraphPoolsSorted)
            .filter((subgraphPool) => {
            return (!poolAddressesSoFar.has(subgraphPool.id) &&
                !(tokensToAvoidOnSecondHops === null || tokensToAvoidOnSecondHops === void 0 ? void 0 : tokensToAvoidOnSecondHops.includes(secondHopId.toLowerCase())) &&
                (subgraphPool.token0.id == secondHopId ||
                    subgraphPool.token1.id == secondHopId));
        })
            .slice(0, (_a = topNSecondHopForTokenAddress === null || topNSecondHopForTokenAddress === void 0 ? void 0 : topNSecondHopForTokenAddress.get(secondHopId)) !== null && _a !== void 0 ? _a : topNSecondHop)
            .value();
    })
        .uniqBy((pool) => pool.id)
        .value();
    addToAddressSet(topByTVLUsingTokenInSecondHops);
    const topByTVLUsingTokenOutSecondHops = (0, lodash_1.default)(topByTVLUsingTokenOut)
        .map((subgraphPool) => {
        return tokenOutAddress == subgraphPool.token0.id
            ? subgraphPool.token1.id
            : subgraphPool.token0.id;
    })
        .flatMap((secondHopId) => {
        var _a;
        return (0, lodash_1.default)(subgraphPoolsSorted)
            .filter((subgraphPool) => {
            return (!poolAddressesSoFar.has(subgraphPool.id) &&
                !(tokensToAvoidOnSecondHops === null || tokensToAvoidOnSecondHops === void 0 ? void 0 : tokensToAvoidOnSecondHops.includes(secondHopId.toLowerCase())) &&
                (subgraphPool.token0.id == secondHopId ||
                    subgraphPool.token1.id == secondHopId));
        })
            .slice(0, (_a = topNSecondHopForTokenAddress === null || topNSecondHopForTokenAddress === void 0 ? void 0 : topNSecondHopForTokenAddress.get(secondHopId)) !== null && _a !== void 0 ? _a : topNSecondHop)
            .value();
    })
        .uniqBy((pool) => pool.id)
        .value();
    addToAddressSet(topByTVLUsingTokenOutSecondHops);
    const subgraphPools = (0, lodash_1.default)([
        ...topByBaseWithTokenIn,
        ...topByBaseWithTokenOut,
        ...top2DirectSwapPool,
        ...top2EthQuoteTokenPool,
        ...topByTVL,
        ...topByTVLUsingTokenIn,
        ...topByTVLUsingTokenOut,
        ...topByTVLUsingTokenInSecondHops,
        ...topByTVLUsingTokenOutSecondHops,
    ])
        .compact()
        .uniqBy((pool) => pool.id)
        .value();
    const tokenAddresses = (0, lodash_1.default)(subgraphPools)
        .flatMap((subgraphPool) => [subgraphPool.token0.id, subgraphPool.token1.id])
        .compact()
        .uniq()
        .value();
    log_1.log.info(`Getting the ${tokenAddresses.length} tokens within the ${subgraphPools.length} V3 pools we are considering`);
    const tokenAccessor = await tokenProvider.getTokens(tokenAddresses, {
        blockNumber,
    });
    const printV3SubgraphPool = (s) => {
        var _a, _b, _c, _d;
        return `${(_b = (_a = tokenAccessor.getTokenByAddress(s.token0.id)) === null || _a === void 0 ? void 0 : _a.symbol) !== null && _b !== void 0 ? _b : s.token0.id}/${(_d = (_c = tokenAccessor.getTokenByAddress(s.token1.id)) === null || _c === void 0 ? void 0 : _c.symbol) !== null && _d !== void 0 ? _d : s.token1.id}/${s.feeTier}`;
    };
    log_1.log.info({
        topByBaseWithTokenIn: topByBaseWithTokenIn.map(printV3SubgraphPool),
        topByBaseWithTokenOut: topByBaseWithTokenOut.map(printV3SubgraphPool),
        topByTVL: topByTVL.map(printV3SubgraphPool),
        topByTVLUsingTokenIn: topByTVLUsingTokenIn.map(printV3SubgraphPool),
        topByTVLUsingTokenOut: topByTVLUsingTokenOut.map(printV3SubgraphPool),
        topByTVLUsingTokenInSecondHops: topByTVLUsingTokenInSecondHops.map(printV3SubgraphPool),
        topByTVLUsingTokenOutSecondHops: topByTVLUsingTokenOutSecondHops.map(printV3SubgraphPool),
        top2DirectSwap: top2DirectSwapPool.map(printV3SubgraphPool),
        top2EthQuotePool: top2EthQuoteTokenPool.map(printV3SubgraphPool),
    }, `V3 Candidate Pools`);
    const tokenPairsRaw = lodash_1.default.map(subgraphPools, (subgraphPool) => {
        const tokenA = tokenAccessor.getTokenByAddress(subgraphPool.token0.id);
        const tokenB = tokenAccessor.getTokenByAddress(subgraphPool.token1.id);
        let fee;
        try {
            fee = (0, amounts_1.parseFeeAmount)(subgraphPool.feeTier);
        }
        catch (err) {
            log_1.log.info({ subgraphPool }, `Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}/${subgraphPool.feeTier} because fee tier not supported`);
            return undefined;
        }
        if (!tokenA || !tokenB) {
            log_1.log.info(`Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}/${fee} because ${tokenA ? subgraphPool.token1.id : subgraphPool.token0.id} not found by token provider`);
            return undefined;
        }
        return [tokenA, tokenB, fee];
    });
    const tokenPairs = lodash_1.default.compact(tokenPairsRaw);
    metric_1.metric.putMetric('V3PoolsFilterLoad', Date.now() - beforePoolsFiltered, metric_1.MetricLoggerUnit.Milliseconds);
    const beforePoolsLoad = Date.now();
    const poolAccessor = await poolProvider.getPools(tokenPairs, {
        blockNumber,
    });
    metric_1.metric.putMetric('V3PoolsLoad', Date.now() - beforePoolsLoad, metric_1.MetricLoggerUnit.Milliseconds);
    const poolsBySelection = {
        protocol: router_sdk_1.Protocol.V3,
        selections: {
            topByBaseWithTokenIn,
            topByBaseWithTokenOut,
            topByDirectSwapPool: top2DirectSwapPool,
            topByEthQuoteTokenPool: top2EthQuoteTokenPool,
            topByTVL,
            topByTVLUsingTokenIn,
            topByTVLUsingTokenOut,
            topByTVLUsingTokenInSecondHops,
            topByTVLUsingTokenOutSecondHops,
        },
    };
    return { poolAccessor, candidatePools: poolsBySelection, subgraphPools };
}
exports.getV3CandidatePools = getV3CandidatePools;
async function getV2CandidatePools({ tokenIn, tokenOut, routeType, routingConfig, subgraphProvider, tokenProvider, poolProvider, blockedTokenListProvider, chainId, }) {
    var _a;
    const { blockNumber, v2PoolSelection: { topN, topNDirectSwaps, topNTokenInOut, topNSecondHop, tokensToAvoidOnSecondHops, topNWithEachBaseToken, topNWithBaseToken, }, } = routingConfig;
    const tokenInAddress = tokenIn.address.toLowerCase();
    const tokenOutAddress = tokenOut.address.toLowerCase();
    const beforeSubgraphPools = Date.now();
    const allPoolsRaw = await subgraphProvider.getPools(tokenIn, tokenOut, {
        blockNumber,
    });
    // With tens of thousands of V2 pools, operations that copy pools become costly.
    // Mutate the pool directly rather than creating a new pool / token to optimmize for speed.
    for (const pool of allPoolsRaw) {
        pool.token0.id = pool.token0.id.toLowerCase();
        pool.token1.id = pool.token1.id.toLowerCase();
    }
    metric_1.metric.putMetric('V2SubgraphPoolsLoad', Date.now() - beforeSubgraphPools, metric_1.MetricLoggerUnit.Milliseconds);
    const beforePoolsFiltered = Date.now();
    // Sort by pool reserve in descending order.
    const subgraphPoolsSorted = allPoolsRaw.sort((a, b) => b.reserve - a.reserve);
    const poolAddressesSoFar = new Set();
    // Always add the direct swap pool into the mix regardless of if it exists in the subgraph pool list.
    // Ensures that new pools can be swapped on immediately, and that if a pool was filtered out of the
    // subgraph query for some reason (e.g. trackedReserveETH was 0), then we still consider it.
    let topByDirectSwapPool = [];
    if (topNDirectSwaps > 0) {
        const { token0, token1, poolAddress } = poolProvider.getPoolAddress(tokenIn, tokenOut);
        poolAddressesSoFar.add(poolAddress.toLowerCase());
        topByDirectSwapPool = [
            {
                id: poolAddress,
                token0: {
                    id: token0.address,
                },
                token1: {
                    id: token1.address,
                },
                supply: 10000,
                reserve: 10000,
                reserveUSD: 10000, // Not used. Set to arbitrary number.
            },
        ];
    }
    const wethAddress = util_1.WRAPPED_NATIVE_CURRENCY[chainId].address.toLowerCase();
    const topByBaseWithTokenInMap = new Map();
    const topByBaseWithTokenOutMap = new Map();
    const baseTokens = (_a = baseTokensByChain[chainId]) !== null && _a !== void 0 ? _a : [];
    const baseTokensAddresses = new Set();
    baseTokens.forEach((token) => {
        const baseTokenAddr = token.address.toLowerCase();
        baseTokensAddresses.add(baseTokenAddr);
        topByBaseWithTokenInMap.set(baseTokenAddr, new SubcategorySelectionPools([], topNWithEachBaseToken));
        topByBaseWithTokenOutMap.set(baseTokenAddr, new SubcategorySelectionPools([], topNWithEachBaseToken));
    });
    let topByBaseWithTokenInPoolsFound = 0;
    let topByBaseWithTokenOutPoolsFound = 0;
    // Main reason we need this is for gas estimates
    // There can ever only be 1 Token/ETH pool, so we will only look for 1
    let topNEthQuoteToken = 1;
    // but, we only need it if token out is not ETH.
    if (tokenOut.symbol == 'WETH' ||
        tokenOut.symbol == 'WETH9' ||
        tokenOut.symbol == 'ETH') {
        // if it's eth we change the topN to 0, so we can break early from the loop.
        topNEthQuoteToken = 0;
    }
    const topByEthQuoteTokenPool = [];
    const topByTVLUsingTokenIn = [];
    const topByTVLUsingTokenOut = [];
    const topByTVL = [];
    // Used to track how many iterations we do in the first loop
    let loopsInFirstIteration = 0;
    // Filtering step for up to first hop
    // The pools are pre-sorted, so we can just iterate through them and fill our heuristics.
    for (const subgraphPool of subgraphPoolsSorted) {
        loopsInFirstIteration += 1;
        // Check if we have satisfied all the heuristics, if so, we can stop.
        if (topByBaseWithTokenInPoolsFound >= topNWithBaseToken &&
            topByBaseWithTokenOutPoolsFound >= topNWithBaseToken &&
            topByEthQuoteTokenPool.length >= topNEthQuoteToken &&
            topByTVL.length >= topN &&
            topByTVLUsingTokenIn.length >= topNTokenInOut &&
            topByTVLUsingTokenOut.length >= topNTokenInOut) {
            // We have satisfied all the heuristics, so we can stop.
            break;
        }
        if (poolAddressesSoFar.has(subgraphPool.id)) {
            // We've already added this pool, so skip it.
            continue;
        }
        // Only consider pools where neither tokens are in the blocked token list.
        if (blockedTokenListProvider) {
            const [token0InBlocklist, token1InBlocklist] = await Promise.all([
                blockedTokenListProvider.hasTokenByAddress(subgraphPool.token0.id),
                blockedTokenListProvider.hasTokenByAddress(subgraphPool.token1.id),
            ]);
            if (token0InBlocklist || token1InBlocklist) {
                continue;
            }
        }
        const tokenInToken0TopByBase = topByBaseWithTokenInMap.get(subgraphPool.token0.id);
        if (topByBaseWithTokenInPoolsFound < topNWithBaseToken &&
            tokenInToken0TopByBase &&
            subgraphPool.token0.id != tokenOutAddress &&
            subgraphPool.token1.id == tokenInAddress) {
            topByBaseWithTokenInPoolsFound += 1;
            poolAddressesSoFar.add(subgraphPool.id);
            if (topByTVLUsingTokenIn.length < topNTokenInOut) {
                topByTVLUsingTokenIn.push(subgraphPool);
            }
            if (routeType === sdk_core_1.TradeType.EXACT_OUTPUT &&
                subgraphPool.token0.id == wethAddress) {
                topByEthQuoteTokenPool.push(subgraphPool);
            }
            tokenInToken0TopByBase.pools.push(subgraphPool);
            continue;
        }
        const tokenInToken1TopByBase = topByBaseWithTokenInMap.get(subgraphPool.token1.id);
        if (topByBaseWithTokenInPoolsFound < topNWithBaseToken &&
            tokenInToken1TopByBase &&
            subgraphPool.token0.id == tokenInAddress &&
            subgraphPool.token1.id != tokenOutAddress) {
            topByBaseWithTokenInPoolsFound += 1;
            poolAddressesSoFar.add(subgraphPool.id);
            if (topByTVLUsingTokenIn.length < topNTokenInOut) {
                topByTVLUsingTokenIn.push(subgraphPool);
            }
            if (routeType === sdk_core_1.TradeType.EXACT_OUTPUT &&
                subgraphPool.token1.id == wethAddress) {
                topByEthQuoteTokenPool.push(subgraphPool);
            }
            tokenInToken1TopByBase.pools.push(subgraphPool);
            continue;
        }
        const tokenOutToken0TopByBase = topByBaseWithTokenOutMap.get(subgraphPool.token0.id);
        if (topByBaseWithTokenOutPoolsFound < topNWithBaseToken &&
            tokenOutToken0TopByBase &&
            subgraphPool.token0.id != tokenInAddress &&
            subgraphPool.token1.id == tokenOutAddress) {
            topByBaseWithTokenOutPoolsFound += 1;
            poolAddressesSoFar.add(subgraphPool.id);
            if (topByTVLUsingTokenOut.length < topNTokenInOut) {
                topByTVLUsingTokenOut.push(subgraphPool);
            }
            if (routeType === sdk_core_1.TradeType.EXACT_INPUT &&
                subgraphPool.token0.id == wethAddress) {
                topByEthQuoteTokenPool.push(subgraphPool);
            }
            tokenOutToken0TopByBase.pools.push(subgraphPool);
            continue;
        }
        const tokenOutToken1TopByBase = topByBaseWithTokenOutMap.get(subgraphPool.token1.id);
        if (topByBaseWithTokenOutPoolsFound < topNWithBaseToken &&
            tokenOutToken1TopByBase &&
            subgraphPool.token0.id == tokenOutAddress &&
            subgraphPool.token1.id != tokenInAddress) {
            topByBaseWithTokenOutPoolsFound += 1;
            poolAddressesSoFar.add(subgraphPool.id);
            if (topByTVLUsingTokenOut.length < topNTokenInOut) {
                topByTVLUsingTokenOut.push(subgraphPool);
            }
            if (routeType === sdk_core_1.TradeType.EXACT_INPUT &&
                subgraphPool.token1.id == wethAddress) {
                topByEthQuoteTokenPool.push(subgraphPool);
            }
            tokenOutToken1TopByBase.pools.push(subgraphPool);
            continue;
        }
        // Note: we do not need to check other native currencies for the V2 Protocol
        if (topByEthQuoteTokenPool.length < topNEthQuoteToken &&
            ((routeType === sdk_core_1.TradeType.EXACT_INPUT &&
                ((subgraphPool.token0.id == wethAddress &&
                    subgraphPool.token1.id == tokenOutAddress) ||
                    (subgraphPool.token1.id == wethAddress &&
                        subgraphPool.token0.id == tokenOutAddress))) ||
                (routeType === sdk_core_1.TradeType.EXACT_OUTPUT &&
                    ((subgraphPool.token0.id == wethAddress &&
                        subgraphPool.token1.id == tokenInAddress) ||
                        (subgraphPool.token1.id == wethAddress &&
                            subgraphPool.token0.id == tokenInAddress))))) {
            poolAddressesSoFar.add(subgraphPool.id);
            topByEthQuoteTokenPool.push(subgraphPool);
            continue;
        }
        if (topByTVL.length < topN) {
            poolAddressesSoFar.add(subgraphPool.id);
            topByTVL.push(subgraphPool);
            continue;
        }
        if (topByTVLUsingTokenIn.length < topNTokenInOut &&
            (subgraphPool.token0.id == tokenInAddress ||
                subgraphPool.token1.id == tokenInAddress)) {
            poolAddressesSoFar.add(subgraphPool.id);
            topByTVLUsingTokenIn.push(subgraphPool);
            continue;
        }
        if (topByTVLUsingTokenOut.length < topNTokenInOut &&
            (subgraphPool.token0.id == tokenOutAddress ||
                subgraphPool.token1.id == tokenOutAddress)) {
            poolAddressesSoFar.add(subgraphPool.id);
            topByTVLUsingTokenOut.push(subgraphPool);
            continue;
        }
    }
    metric_1.metric.putMetric('V2SubgraphLoopsInFirstIteration', loopsInFirstIteration, metric_1.MetricLoggerUnit.Count);
    const topByBaseWithTokenIn = [];
    for (const topByBaseWithTokenInSelection of topByBaseWithTokenInMap.values()) {
        topByBaseWithTokenIn.push(...topByBaseWithTokenInSelection.pools);
    }
    const topByBaseWithTokenOut = [];
    for (const topByBaseWithTokenOutSelection of topByBaseWithTokenOutMap.values()) {
        topByBaseWithTokenOut.push(...topByBaseWithTokenOutSelection.pools);
    }
    // Filtering step for second hops
    const topByTVLUsingTokenInSecondHopsMap = new Map();
    const topByTVLUsingTokenOutSecondHopsMap = new Map();
    const tokenInSecondHopAddresses = topByTVLUsingTokenIn
        .filter((pool) => {
        // filtering second hops
        if (tokenInAddress === pool.token0.id) {
            return !(tokensToAvoidOnSecondHops === null || tokensToAvoidOnSecondHops === void 0 ? void 0 : tokensToAvoidOnSecondHops.includes(pool.token1.id.toLowerCase()));
        }
        else {
            return !(tokensToAvoidOnSecondHops === null || tokensToAvoidOnSecondHops === void 0 ? void 0 : tokensToAvoidOnSecondHops.includes(pool.token0.id.toLowerCase()));
        }
    })
        .map((pool) => tokenInAddress === pool.token0.id ? pool.token1.id : pool.token0.id);
    const tokenOutSecondHopAddresses = topByTVLUsingTokenOut
        .filter((pool) => {
        // filtering second hops
        if (tokenOutAddress === pool.token0.id) {
            return !(tokensToAvoidOnSecondHops === null || tokensToAvoidOnSecondHops === void 0 ? void 0 : tokensToAvoidOnSecondHops.includes(pool.token1.id.toLowerCase()));
        }
        else {
            return !(tokensToAvoidOnSecondHops === null || tokensToAvoidOnSecondHops === void 0 ? void 0 : tokensToAvoidOnSecondHops.includes(pool.token0.id.toLowerCase()));
        }
    })
        .map((pool) => tokenOutAddress === pool.token0.id ? pool.token1.id : pool.token0.id);
    for (const secondHopId of tokenInSecondHopAddresses) {
        topByTVLUsingTokenInSecondHopsMap.set(secondHopId, new SubcategorySelectionPools([], topNSecondHop));
    }
    for (const secondHopId of tokenOutSecondHopAddresses) {
        topByTVLUsingTokenOutSecondHopsMap.set(secondHopId, new SubcategorySelectionPools([], topNSecondHop));
    }
    // Used to track how many iterations we do in the second loop
    let loopsInSecondIteration = 0;
    if (tokenInSecondHopAddresses.length > 0 ||
        tokenOutSecondHopAddresses.length > 0) {
        for (const subgraphPool of subgraphPoolsSorted) {
            loopsInSecondIteration += 1;
            let allTokenInSecondHopsHaveTheirTopN = true;
            for (const secondHopPools of topByTVLUsingTokenInSecondHopsMap.values()) {
                if (!secondHopPools.hasEnoughPools()) {
                    allTokenInSecondHopsHaveTheirTopN = false;
                    break;
                }
            }
            let allTokenOutSecondHopsHaveTheirTopN = true;
            for (const secondHopPools of topByTVLUsingTokenOutSecondHopsMap.values()) {
                if (!secondHopPools.hasEnoughPools()) {
                    allTokenOutSecondHopsHaveTheirTopN = false;
                    break;
                }
            }
            if (allTokenInSecondHopsHaveTheirTopN &&
                allTokenOutSecondHopsHaveTheirTopN) {
                // We have satisfied all the heuristics, so we can stop.
                break;
            }
            if (poolAddressesSoFar.has(subgraphPool.id)) {
                continue;
            }
            // Only consider pools where neither tokens are in the blocked token list.
            if (blockedTokenListProvider) {
                const [token0InBlocklist, token1InBlocklist] = await Promise.all([
                    blockedTokenListProvider.hasTokenByAddress(subgraphPool.token0.id),
                    blockedTokenListProvider.hasTokenByAddress(subgraphPool.token1.id),
                ]);
                if (token0InBlocklist || token1InBlocklist) {
                    continue;
                }
            }
            const tokenInToken0SecondHop = topByTVLUsingTokenInSecondHopsMap.get(subgraphPool.token0.id);
            if (tokenInToken0SecondHop && !tokenInToken0SecondHop.hasEnoughPools()) {
                poolAddressesSoFar.add(subgraphPool.id);
                tokenInToken0SecondHop.pools.push(subgraphPool);
                continue;
            }
            const tokenInToken1SecondHop = topByTVLUsingTokenInSecondHopsMap.get(subgraphPool.token1.id);
            if (tokenInToken1SecondHop && !tokenInToken1SecondHop.hasEnoughPools()) {
                poolAddressesSoFar.add(subgraphPool.id);
                tokenInToken1SecondHop.pools.push(subgraphPool);
                continue;
            }
            const tokenOutToken0SecondHop = topByTVLUsingTokenOutSecondHopsMap.get(subgraphPool.token0.id);
            if (tokenOutToken0SecondHop &&
                !tokenOutToken0SecondHop.hasEnoughPools()) {
                poolAddressesSoFar.add(subgraphPool.id);
                tokenOutToken0SecondHop.pools.push(subgraphPool);
                continue;
            }
            const tokenOutToken1SecondHop = topByTVLUsingTokenOutSecondHopsMap.get(subgraphPool.token1.id);
            if (tokenOutToken1SecondHop &&
                !tokenOutToken1SecondHop.hasEnoughPools()) {
                poolAddressesSoFar.add(subgraphPool.id);
                tokenOutToken1SecondHop.pools.push(subgraphPool);
                continue;
            }
        }
    }
    metric_1.metric.putMetric('V2SubgraphLoopsInSecondIteration', loopsInSecondIteration, metric_1.MetricLoggerUnit.Count);
    const topByTVLUsingTokenInSecondHops = [];
    for (const secondHopPools of topByTVLUsingTokenInSecondHopsMap.values()) {
        topByTVLUsingTokenInSecondHops.push(...secondHopPools.pools);
    }
    const topByTVLUsingTokenOutSecondHops = [];
    for (const secondHopPools of topByTVLUsingTokenOutSecondHopsMap.values()) {
        topByTVLUsingTokenOutSecondHops.push(...secondHopPools.pools);
    }
    const subgraphPools = (0, lodash_1.default)([
        ...topByBaseWithTokenIn,
        ...topByBaseWithTokenOut,
        ...topByDirectSwapPool,
        ...topByEthQuoteTokenPool,
        ...topByTVL,
        ...topByTVLUsingTokenIn,
        ...topByTVLUsingTokenOut,
        ...topByTVLUsingTokenInSecondHops,
        ...topByTVLUsingTokenOutSecondHops,
    ])
        .uniqBy((pool) => pool.id)
        .value();
    const tokenAddressesSet = new Set();
    for (const pool of subgraphPools) {
        tokenAddressesSet.add(pool.token0.id);
        tokenAddressesSet.add(pool.token1.id);
    }
    const tokenAddresses = Array.from(tokenAddressesSet);
    log_1.log.info(`Getting the ${tokenAddresses.length} tokens within the ${subgraphPools.length} V2 pools we are considering`);
    const tokenAccessor = await tokenProvider.getTokens(tokenAddresses, {
        blockNumber,
    });
    const printV2SubgraphPool = (s) => {
        var _a, _b, _c, _d;
        return `${(_b = (_a = tokenAccessor.getTokenByAddress(s.token0.id)) === null || _a === void 0 ? void 0 : _a.symbol) !== null && _b !== void 0 ? _b : s.token0.id}/${(_d = (_c = tokenAccessor.getTokenByAddress(s.token1.id)) === null || _c === void 0 ? void 0 : _c.symbol) !== null && _d !== void 0 ? _d : s.token1.id}`;
    };
    log_1.log.info({
        topByBaseWithTokenIn: topByBaseWithTokenIn.map(printV2SubgraphPool),
        topByBaseWithTokenOut: topByBaseWithTokenOut.map(printV2SubgraphPool),
        topByTVL: topByTVL.map(printV2SubgraphPool),
        topByTVLUsingTokenIn: topByTVLUsingTokenIn.map(printV2SubgraphPool),
        topByTVLUsingTokenOut: topByTVLUsingTokenOut.map(printV2SubgraphPool),
        topByTVLUsingTokenInSecondHops: topByTVLUsingTokenInSecondHops.map(printV2SubgraphPool),
        topByTVLUsingTokenOutSecondHops: topByTVLUsingTokenOutSecondHops.map(printV2SubgraphPool),
        top2DirectSwap: topByDirectSwapPool.map(printV2SubgraphPool),
        top2EthQuotePool: topByEthQuoteTokenPool.map(printV2SubgraphPool),
    }, `V2 Candidate pools`);
    const tokenPairsRaw = lodash_1.default.map(subgraphPools, (subgraphPool) => {
        const tokenA = tokenAccessor.getTokenByAddress(subgraphPool.token0.id);
        const tokenB = tokenAccessor.getTokenByAddress(subgraphPool.token1.id);
        if (!tokenA || !tokenB) {
            log_1.log.info(`Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}`);
            return undefined;
        }
        return [tokenA, tokenB];
    });
    const tokenPairs = lodash_1.default.compact(tokenPairsRaw);
    metric_1.metric.putMetric('V2PoolsFilterLoad', Date.now() - beforePoolsFiltered, metric_1.MetricLoggerUnit.Milliseconds);
    const beforePoolsLoad = Date.now();
    // this should be the only place to enable fee-on-transfer fee fetching,
    // because this places loads pools (pairs of tokens with fot taxes) from the subgraph
    const poolAccessor = await poolProvider.getPools(tokenPairs, routingConfig);
    metric_1.metric.putMetric('V2PoolsLoad', Date.now() - beforePoolsLoad, metric_1.MetricLoggerUnit.Milliseconds);
    const poolsBySelection = {
        protocol: router_sdk_1.Protocol.V2,
        selections: {
            topByBaseWithTokenIn,
            topByBaseWithTokenOut,
            topByDirectSwapPool,
            topByEthQuoteTokenPool,
            topByTVL,
            topByTVLUsingTokenIn,
            topByTVLUsingTokenOut,
            topByTVLUsingTokenInSecondHops,
            topByTVLUsingTokenOutSecondHops,
        },
    };
    return { poolAccessor, candidatePools: poolsBySelection, subgraphPools };
}
exports.getV2CandidatePools = getV2CandidatePools;
async function getMixedRouteCandidatePools({ v3CandidatePools, v2CandidatePools, routingConfig, tokenProvider, v3poolProvider, v2poolProvider, }) {
    const beforeSubgraphPools = Date.now();
    const [{ subgraphPools: V3subgraphPools, candidatePools: V3candidatePools }, { subgraphPools: V2subgraphPools, candidatePools: V2candidatePools },] = [v3CandidatePools, v2CandidatePools];
    metric_1.metric.putMetric('MixedSubgraphPoolsLoad', Date.now() - beforeSubgraphPools, metric_1.MetricLoggerUnit.Milliseconds);
    const beforePoolsFiltered = Date.now();
    /**
     * Main heuristic for pruning mixedRoutes:
     * - we pick V2 pools with higher liq than respective V3 pools, or if the v3 pool doesn't exist
     *
     * This way we can reduce calls to our provider since it's possible to generate a lot of mixed routes
     */
    /// We only really care about pools involving the tokenIn or tokenOut explictly,
    /// since there's no way a long tail token in V2 would be routed through as an intermediary
    const V2topByTVLPoolIds = new Set([
        ...V2candidatePools.selections.topByTVLUsingTokenIn,
        ...V2candidatePools.selections.topByBaseWithTokenIn,
        /// tokenOut:
        ...V2candidatePools.selections.topByTVLUsingTokenOut,
        ...V2candidatePools.selections.topByBaseWithTokenOut,
        /// Direct swap:
        ...V2candidatePools.selections.topByDirectSwapPool,
    ].map((poolId) => poolId.id));
    const V2topByTVLSortedPools = (0, lodash_1.default)(V2subgraphPools)
        .filter((pool) => V2topByTVLPoolIds.has(pool.id))
        .sortBy((pool) => -pool.reserveUSD)
        .value();
    /// we consider all returned V3 pools for this heuristic to "fill in the gaps"
    const V3sortedPools = (0, lodash_1.default)(V3subgraphPools)
        .sortBy((pool) => -pool.tvlUSD)
        .value();
    /// Finding pools with greater reserveUSD on v2 than tvlUSD on v3, or if there is no v3 liquidity
    const buildV2Pools = [];
    V2topByTVLSortedPools.forEach((V2subgraphPool) => {
        const V3subgraphPool = V3sortedPools.find((pool) => (pool.token0.id == V2subgraphPool.token0.id &&
            pool.token1.id == V2subgraphPool.token1.id) ||
            (pool.token0.id == V2subgraphPool.token1.id &&
                pool.token1.id == V2subgraphPool.token0.id));
        if (V3subgraphPool) {
            if (V2subgraphPool.reserveUSD > V3subgraphPool.tvlUSD) {
                log_1.log.info({
                    token0: V2subgraphPool.token0.id,
                    token1: V2subgraphPool.token1.id,
                    v2reserveUSD: V2subgraphPool.reserveUSD,
                    v3tvlUSD: V3subgraphPool.tvlUSD,
                }, `MixedRoute heuristic, found a V2 pool with higher liquidity than its V3 counterpart`);
                buildV2Pools.push(V2subgraphPool);
            }
        }
        else {
            log_1.log.info({
                token0: V2subgraphPool.token0.id,
                token1: V2subgraphPool.token1.id,
                v2reserveUSD: V2subgraphPool.reserveUSD,
            }, `MixedRoute heuristic, found a V2 pool with no V3 counterpart`);
            buildV2Pools.push(V2subgraphPool);
        }
    });
    log_1.log.info(buildV2Pools.length, `Number of V2 candidate pools that fit first heuristic`);
    const subgraphPools = [...buildV2Pools, ...V3sortedPools];
    const tokenAddresses = (0, lodash_1.default)(subgraphPools)
        .flatMap((subgraphPool) => [subgraphPool.token0.id, subgraphPool.token1.id])
        .compact()
        .uniq()
        .value();
    log_1.log.info(`Getting the ${tokenAddresses.length} tokens within the ${subgraphPools.length} pools we are considering`);
    const tokenAccessor = await tokenProvider.getTokens(tokenAddresses, routingConfig);
    const V3tokenPairsRaw = lodash_1.default.map(V3sortedPools, (subgraphPool) => {
        const tokenA = tokenAccessor.getTokenByAddress(subgraphPool.token0.id);
        const tokenB = tokenAccessor.getTokenByAddress(subgraphPool.token1.id);
        let fee;
        try {
            fee = (0, amounts_1.parseFeeAmount)(subgraphPool.feeTier);
        }
        catch (err) {
            log_1.log.info({ subgraphPool }, `Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}/${subgraphPool.feeTier} because fee tier not supported`);
            return undefined;
        }
        if (!tokenA || !tokenB) {
            log_1.log.info(`Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}/${fee} because ${tokenA ? subgraphPool.token1.id : subgraphPool.token0.id} not found by token provider`);
            return undefined;
        }
        return [tokenA, tokenB, fee];
    });
    const V3tokenPairs = lodash_1.default.compact(V3tokenPairsRaw);
    const V2tokenPairsRaw = lodash_1.default.map(buildV2Pools, (subgraphPool) => {
        const tokenA = tokenAccessor.getTokenByAddress(subgraphPool.token0.id);
        const tokenB = tokenAccessor.getTokenByAddress(subgraphPool.token1.id);
        if (!tokenA || !tokenB) {
            log_1.log.info(`Dropping candidate pool for ${subgraphPool.token0.id}/${subgraphPool.token1.id}`);
            return undefined;
        }
        return [tokenA, tokenB];
    });
    const V2tokenPairs = lodash_1.default.compact(V2tokenPairsRaw);
    metric_1.metric.putMetric('MixedPoolsFilterLoad', Date.now() - beforePoolsFiltered, metric_1.MetricLoggerUnit.Milliseconds);
    const beforePoolsLoad = Date.now();
    const [V2poolAccessor, V3poolAccessor] = await Promise.all([
        v2poolProvider.getPools(V2tokenPairs, routingConfig),
        v3poolProvider.getPools(V3tokenPairs, routingConfig),
    ]);
    metric_1.metric.putMetric('MixedPoolsLoad', Date.now() - beforePoolsLoad, metric_1.MetricLoggerUnit.Milliseconds);
    /// @dev a bit tricky here since the original V2CandidateSelections object included pools that we may have dropped
    /// as part of the heuristic. We need to reconstruct a new object with the v3 pools too.
    const buildPoolsBySelection = (key) => {
        return [
            ...buildV2Pools.filter((pool) => V2candidatePools.selections[key].map((p) => p.id).includes(pool.id)),
            ...V3candidatePools.selections[key],
        ];
    };
    const poolsBySelection = {
        protocol: router_sdk_1.Protocol.MIXED,
        selections: {
            topByBaseWithTokenIn: buildPoolsBySelection('topByBaseWithTokenIn'),
            topByBaseWithTokenOut: buildPoolsBySelection('topByBaseWithTokenOut'),
            topByDirectSwapPool: buildPoolsBySelection('topByDirectSwapPool'),
            topByEthQuoteTokenPool: buildPoolsBySelection('topByEthQuoteTokenPool'),
            topByTVL: buildPoolsBySelection('topByTVL'),
            topByTVLUsingTokenIn: buildPoolsBySelection('topByTVLUsingTokenIn'),
            topByTVLUsingTokenOut: buildPoolsBySelection('topByTVLUsingTokenOut'),
            topByTVLUsingTokenInSecondHops: buildPoolsBySelection('topByTVLUsingTokenInSecondHops'),
            topByTVLUsingTokenOutSecondHops: buildPoolsBySelection('topByTVLUsingTokenOutSecondHops'),
        },
    };
    return {
        V2poolAccessor,
        V3poolAccessor,
        candidatePools: poolsBySelection,
        subgraphPools,
    };
}
exports.getMixedRouteCandidatePools = getMixedRouteCandidatePools;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2V0LWNhbmRpZGF0ZS1wb29scy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2FscGhhLXJvdXRlci9mdW5jdGlvbnMvZ2V0LWNhbmRpZGF0ZS1wb29scy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxvREFBK0M7QUFDL0MsZ0RBQThEO0FBQzlELDRDQUE0QztBQUM1QyxvREFBdUI7QUFFdkIsa0RBUzRCO0FBQzVCLHNFQThDMkM7QUFhM0Msd0NBQTBFO0FBQzFFLG1EQUF1RDtBQUN2RCwyQ0FBd0M7QUFDeEMsaURBQWdFO0FBeURoRSxNQUFNLGlCQUFpQixHQUF1QztJQUM1RCxDQUFDLGtCQUFPLENBQUMsT0FBTyxDQUFDLEVBQUU7UUFDakIsNkJBQVk7UUFDWiw2QkFBWTtRQUNaLDZCQUFZO1FBQ1osNEJBQVc7UUFDWCw4QkFBdUIsQ0FBQyxDQUFDLENBQUU7UUFDM0IsNEJBQVc7S0FDWjtJQUNELENBQUMsa0JBQU8sQ0FBQyxRQUFRLENBQUMsRUFBRTtRQUNsQiw2QkFBWTtRQUNaLDhCQUFhO1FBQ2IsOEJBQWE7UUFDYiw4QkFBYTtLQUNkO0lBQ0QsQ0FBQyxrQkFBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsNEJBQVcsRUFBRSw2QkFBWSxDQUFDO0lBQzlDLENBQUMsa0JBQU8sQ0FBQyxlQUFlLENBQUMsRUFBRTtRQUN6QixvQ0FBbUI7UUFDbkIscUNBQW9CO1FBQ3BCLHFDQUFvQjtRQUNwQixxQ0FBb0I7S0FDckI7SUFDRCxDQUFDLGtCQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRTtRQUMxQixnQ0FBb0I7UUFDcEIsaUNBQXFCO1FBQ3JCLGlDQUFxQjtRQUNyQixpQ0FBcUI7S0FDdEI7SUFDRCxDQUFDLGtCQUFPLENBQUMsWUFBWSxDQUFDLEVBQUU7UUFDdEIsNkJBQVk7UUFDWiw4QkFBYTtRQUNiLDhCQUFhO1FBQ2IsOEJBQWE7S0FDZDtJQUNELENBQUMsa0JBQU8sQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDLHFDQUFvQixDQUFDO0lBQ2pELENBQUMsa0JBQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsaUNBQXFCLENBQUM7SUFDbkQsQ0FBQyxrQkFBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsNkJBQVksRUFBRSwrQkFBYyxDQUFDO0lBQ2pELENBQUMsa0JBQU8sQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDLG1DQUFrQixFQUFFLHNDQUFxQixDQUFDO0lBQ3JFLENBQUMsa0JBQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLDBCQUFTLEVBQUUsMEJBQVMsRUFBRSxxQkFBSSxDQUFDO0lBQzVDLENBQUMsa0JBQU8sQ0FBQyxjQUFjLENBQUMsRUFBRTtRQUN4QixvQ0FBbUI7UUFDbkIsb0NBQW1CO1FBQ25CLCtCQUFjO0tBQ2Y7SUFDRCxDQUFDLGtCQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyw0QkFBVyxFQUFFLDZCQUFZLEVBQUUscUNBQW9CLENBQUM7SUFDbkUsQ0FBQyxrQkFBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFO1FBQ2xCLDZCQUFZO1FBQ1osOEJBQWE7UUFDYiw4QkFBYTtRQUNiLCtCQUFjO0tBQ2Y7SUFDRCxDQUFDLGtCQUFPLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyx3QkFBTyxFQUFFLHlCQUFRLEVBQUUseUJBQVEsQ0FBQztJQUM1QyxDQUFDLGtCQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyx5QkFBUSxFQUFFLDBCQUFTLENBQUM7SUFDMUMsQ0FBQyxrQkFBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsMEJBQVMsQ0FBQztJQUMzQixDQUFDLGtCQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyw4QkFBdUIsQ0FBQyxrQkFBTyxDQUFDLEtBQUssQ0FBRSxFQUFFLDJCQUFVLENBQUM7Q0FDdkUsQ0FBQztBQUVGLE1BQU0seUJBQXlCO0lBQzdCLFlBQ1MsS0FBcUIsRUFDWixXQUFtQjtRQUQ1QixVQUFLLEdBQUwsS0FBSyxDQUFnQjtRQUNaLGdCQUFXLEdBQVgsV0FBVyxDQUFRO0lBQ2xDLENBQUM7SUFFRyxjQUFjO1FBQ25CLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQztJQUMvQyxDQUFDO0NBQ0Y7QUFRTSxLQUFLLFVBQVUsbUJBQW1CLENBQUMsRUFDeEMsT0FBTyxFQUNQLFFBQVEsRUFDUixTQUFTLEVBQ1QsYUFBYSxFQUNiLGdCQUFnQixFQUNoQixhQUFhLEVBQ2IsWUFBWSxFQUNaLHdCQUF3QixFQUN4QixPQUFPLEdBQ21COztJQUMxQixNQUFNLEVBQ0osV0FBVyxFQUNYLGVBQWUsRUFBRSxFQUNmLElBQUksRUFDSixlQUFlLEVBQ2YsY0FBYyxFQUNkLGFBQWEsRUFDYiw0QkFBNEIsRUFDNUIseUJBQXlCLEVBQ3pCLHFCQUFxQixFQUNyQixpQkFBaUIsR0FDbEIsR0FDRixHQUFHLGFBQWEsQ0FBQztJQUNsQixNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ3JELE1BQU0sZUFBZSxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFdkQsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFFdkMsTUFBTSxRQUFRLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLFFBQVEsRUFBRTtRQUNsRSxXQUFXO0tBQ1osQ0FBQyxDQUFDO0lBRUgsU0FBRyxDQUFDLElBQUksQ0FDTixFQUFFLFdBQVcsRUFBRSxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxFQUNyQyx5Q0FBeUMsQ0FDMUMsQ0FBQztJQUVGLG1FQUFtRTtJQUNuRSwyRUFBMkU7SUFDM0UsS0FBSyxNQUFNLElBQUksSUFBSSxRQUFRLEVBQUU7UUFDM0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDOUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUM7S0FDL0M7SUFFRCxlQUFNLENBQUMsU0FBUyxDQUNkLHFCQUFxQixFQUNyQixJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsbUJBQW1CLEVBQ2hDLHlCQUFnQixDQUFDLFlBQVksQ0FDOUIsQ0FBQztJQUVGLE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRXZDLDBFQUEwRTtJQUMxRSxJQUFJLGFBQWEsR0FBcUIsUUFBUSxDQUFDO0lBQy9DLElBQUksd0JBQXdCLEVBQUU7UUFDNUIsYUFBYSxHQUFHLEVBQUUsQ0FBQztRQUNuQixLQUFLLE1BQU0sSUFBSSxJQUFJLFFBQVEsRUFBRTtZQUMzQixNQUFNLGlCQUFpQixHQUNyQixNQUFNLHdCQUF3QixDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDbkUsTUFBTSxpQkFBaUIsR0FDckIsTUFBTSx3QkFBd0IsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBRW5FLElBQUksaUJBQWlCLElBQUksaUJBQWlCLEVBQUU7Z0JBQzFDLFNBQVM7YUFDVjtZQUVELGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7U0FDMUI7S0FDRjtJQUVELHFDQUFxQztJQUNyQyxNQUFNLG1CQUFtQixHQUFHLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUU5RSxTQUFHLENBQUMsSUFBSSxDQUNOLDRDQUE0QyxRQUFRLENBQUMsTUFBTSxPQUFPLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxDQUNoRyxDQUFDO0lBRUYsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBQzdDLE1BQU0sZUFBZSxHQUFHLENBQUMsS0FBdUIsRUFBRSxFQUFFO1FBQ2xELElBQUEsZ0JBQUMsRUFBQyxLQUFLLENBQUM7YUFDTCxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7YUFDdEIsT0FBTyxDQUFDLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztJQUNuRSxDQUFDLENBQUM7SUFFRixNQUFNLFVBQVUsR0FBRyxNQUFBLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxtQ0FBSSxFQUFFLENBQUM7SUFFcEQsTUFBTSxvQkFBb0IsR0FBRyxJQUFBLGdCQUFDLEVBQUMsVUFBVSxDQUFDO1NBQ3ZDLE9BQU8sQ0FBQyxDQUFDLEtBQVksRUFBRSxFQUFFO1FBQ3hCLE9BQU8sSUFBQSxnQkFBQyxFQUFDLG1CQUFtQixDQUFDO2FBQzFCLE1BQU0sQ0FBQyxDQUFDLFlBQVksRUFBRSxFQUFFO1lBQ3ZCLE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakQsT0FBTyxDQUNMLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksWUFBWTtnQkFDckMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksY0FBYyxDQUFDO2dCQUMzQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLFlBQVk7b0JBQ3JDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWMsQ0FBQyxDQUM1QyxDQUFDO1FBQ0osQ0FBQyxDQUFDO2FBQ0QsTUFBTSxDQUFDLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUM7YUFDaEQsS0FBSyxDQUFDLENBQUMsRUFBRSxxQkFBcUIsQ0FBQzthQUMvQixLQUFLLEVBQUUsQ0FBQztJQUNiLENBQUMsQ0FBQztTQUNELE1BQU0sQ0FBQyxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDO1NBQ2hELEtBQUssQ0FBQyxDQUFDLEVBQUUsaUJBQWlCLENBQUM7U0FDM0IsS0FBSyxFQUFFLENBQUM7SUFFWCxNQUFNLHFCQUFxQixHQUFHLElBQUEsZ0JBQUMsRUFBQyxVQUFVLENBQUM7U0FDeEMsT0FBTyxDQUFDLENBQUMsS0FBWSxFQUFFLEVBQUU7UUFDeEIsT0FBTyxJQUFBLGdCQUFDLEVBQUMsbUJBQW1CLENBQUM7YUFDMUIsTUFBTSxDQUFDLENBQUMsWUFBWSxFQUFFLEVBQUU7WUFDdkIsTUFBTSxZQUFZLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNqRCxPQUFPLENBQ0wsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxZQUFZO2dCQUNyQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxlQUFlLENBQUM7Z0JBQzVDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksWUFBWTtvQkFDckMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksZUFBZSxDQUFDLENBQzdDLENBQUM7UUFDSixDQUFDLENBQUM7YUFDRCxNQUFNLENBQUMsQ0FBQyxhQUFhLEVBQUUsRUFBRSxDQUFDLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQzthQUNoRCxLQUFLLENBQUMsQ0FBQyxFQUFFLHFCQUFxQixDQUFDO2FBQy9CLEtBQUssRUFBRSxDQUFDO0lBQ2IsQ0FBQyxDQUFDO1NBQ0QsTUFBTSxDQUFDLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUM7U0FDaEQsS0FBSyxDQUFDLENBQUMsRUFBRSxpQkFBaUIsQ0FBQztTQUMzQixLQUFLLEVBQUUsQ0FBQztJQUVYLElBQUksa0JBQWtCLEdBQUcsSUFBQSxnQkFBQyxFQUFDLG1CQUFtQixDQUFDO1NBQzVDLE1BQU0sQ0FBQyxDQUFDLFlBQVksRUFBRSxFQUFFO1FBQ3ZCLE9BQU8sQ0FDTCxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1lBQ3hDLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxjQUFjO2dCQUN4QyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxlQUFlLENBQUM7Z0JBQzFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksY0FBYztvQkFDdkMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksZUFBZSxDQUFDLENBQUMsQ0FDaEQsQ0FBQztJQUNKLENBQUMsQ0FBQztTQUNELEtBQUssQ0FBQyxDQUFDLEVBQUUsZUFBZSxDQUFDO1NBQ3pCLEtBQUssRUFBRSxDQUFDO0lBRVgsSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLElBQUksQ0FBQyxJQUFJLGVBQWUsR0FBRyxDQUFDLEVBQUU7UUFDekQsZ0ZBQWdGO1FBQ2hGLCtGQUErRjtRQUMvRix1R0FBdUc7UUFDdkcsa0JBQWtCLEdBQUcsZ0JBQUMsQ0FBQyxHQUFHLENBQ3hCLENBQUMsa0JBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQVMsQ0FBQyxNQUFNLEVBQUUsa0JBQVMsQ0FBQyxHQUFHLEVBQUUsa0JBQVMsQ0FBQyxNQUFNLENBQUMsRUFDbkUsQ0FBQyxTQUFTLEVBQUUsRUFBRTtZQUNaLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLFlBQVksQ0FBQyxjQUFjLENBQ2pFLE9BQU8sRUFDUCxRQUFRLEVBQ1IsU0FBUyxDQUNWLENBQUM7WUFDRixPQUFPO2dCQUNMLEVBQUUsRUFBRSxXQUFXO2dCQUNmLE9BQU8sRUFBRSxJQUFBLHVCQUFnQixFQUFDLFNBQVMsQ0FBQztnQkFDcEMsU0FBUyxFQUFFLE9BQU87Z0JBQ2xCLE1BQU0sRUFBRTtvQkFDTixFQUFFLEVBQUUsTUFBTSxDQUFDLE9BQU87aUJBQ25CO2dCQUNELE1BQU0sRUFBRTtvQkFDTixFQUFFLEVBQUUsTUFBTSxDQUFDLE9BQU87aUJBQ25CO2dCQUNELE1BQU0sRUFBRSxLQUFLO2dCQUNiLE1BQU0sRUFBRSxLQUFLO2FBQ2QsQ0FBQztRQUNKLENBQUMsQ0FDRixDQUFDO0tBQ0g7SUFFRCxlQUFlLENBQUMsa0JBQWtCLENBQUMsQ0FBQztJQUVwQyxNQUFNLG9CQUFvQixHQUN4QixNQUFBLDhCQUF1QixDQUFDLE9BQU8sQ0FBQywwQ0FBRSxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFMUQseUZBQXlGO0lBQ3pGLHFHQUFxRztJQUNyRyw4QkFBOEI7SUFDOUIsSUFBSSxxQkFBcUIsR0FBcUIsRUFBRSxDQUFDO0lBQ2pELElBQ0UsQ0FBQyxDQUFBLE1BQUEsOEJBQXVCLENBQUMsT0FBTyxDQUFDLDBDQUFFLE1BQU07U0FDdkMsTUFBQSw4QkFBdUIsQ0FBQyxrQkFBTyxDQUFDLE9BQU8sQ0FBQywwQ0FBRSxNQUFNLENBQUE7UUFDaEQsUUFBUSxDQUFDLE1BQU0sSUFBSSxNQUFNO1FBQ3pCLFFBQVEsQ0FBQyxNQUFNLElBQUksT0FBTztRQUMxQixRQUFRLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQztRQUMzQixDQUFDLENBQUEsTUFBQSw4QkFBdUIsQ0FBQyxPQUFPLENBQUMsMENBQUUsTUFBTSxLQUFJLCtCQUFjLENBQUMsTUFBTTtZQUNoRSxRQUFRLENBQUMsTUFBTSxJQUFJLE9BQU87WUFDMUIsUUFBUSxDQUFDLE1BQU0sSUFBSSxRQUFRLENBQUMsRUFDOUI7UUFDQSxxQkFBcUIsR0FBRyxJQUFBLGdCQUFDLEVBQUMsbUJBQW1CLENBQUM7YUFDM0MsTUFBTSxDQUFDLENBQUMsWUFBWSxFQUFFLEVBQUU7WUFDdkIsSUFBSSxTQUFTLElBQUksb0JBQVMsQ0FBQyxXQUFXLEVBQUU7Z0JBQ3RDLE9BQU8sQ0FDTCxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLG9CQUFvQjtvQkFDN0MsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksZUFBZSxDQUFDO29CQUM1QyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLG9CQUFvQjt3QkFDN0MsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksZUFBZSxDQUFDLENBQzdDLENBQUM7YUFDSDtpQkFBTTtnQkFDTCxPQUFPLENBQ0wsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxvQkFBb0I7b0JBQzdDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWMsQ0FBQztvQkFDM0MsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxvQkFBb0I7d0JBQzdDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWMsQ0FBQyxDQUM1QyxDQUFDO2FBQ0g7UUFDSCxDQUFDLENBQUM7YUFDRCxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzthQUNYLEtBQUssRUFBRSxDQUFDO0tBQ1o7SUFFRCxlQUFlLENBQUMscUJBQXFCLENBQUMsQ0FBQztJQUV2QyxNQUFNLFFBQVEsR0FBRyxJQUFBLGdCQUFDLEVBQUMsbUJBQW1CLENBQUM7U0FDcEMsTUFBTSxDQUFDLENBQUMsWUFBWSxFQUFFLEVBQUU7UUFDdkIsT0FBTyxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDbEQsQ0FBQyxDQUFDO1NBQ0QsS0FBSyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUM7U0FDZCxLQUFLLEVBQUUsQ0FBQztJQUVYLGVBQWUsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUUxQixNQUFNLG9CQUFvQixHQUFHLElBQUEsZ0JBQUMsRUFBQyxtQkFBbUIsQ0FBQztTQUNoRCxNQUFNLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTtRQUN2QixPQUFPLENBQ0wsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUN4QyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWM7Z0JBQ3ZDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWMsQ0FBQyxDQUM1QyxDQUFDO0lBQ0osQ0FBQyxDQUFDO1NBQ0QsS0FBSyxDQUFDLENBQUMsRUFBRSxjQUFjLENBQUM7U0FDeEIsS0FBSyxFQUFFLENBQUM7SUFFWCxlQUFlLENBQUMsb0JBQW9CLENBQUMsQ0FBQztJQUV0QyxNQUFNLHFCQUFxQixHQUFHLElBQUEsZ0JBQUMsRUFBQyxtQkFBbUIsQ0FBQztTQUNqRCxNQUFNLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTtRQUN2QixPQUFPLENBQ0wsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUN4QyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGVBQWU7Z0JBQ3hDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGVBQWUsQ0FBQyxDQUM3QyxDQUFDO0lBQ0osQ0FBQyxDQUFDO1NBQ0QsS0FBSyxDQUFDLENBQUMsRUFBRSxjQUFjLENBQUM7U0FDeEIsS0FBSyxFQUFFLENBQUM7SUFFWCxlQUFlLENBQUMscUJBQXFCLENBQUMsQ0FBQztJQUV2QyxNQUFNLDhCQUE4QixHQUFHLElBQUEsZ0JBQUMsRUFBQyxvQkFBb0IsQ0FBQztTQUMzRCxHQUFHLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTtRQUNwQixPQUFPLGNBQWMsSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUU7WUFDN0MsQ0FBQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRTtZQUN4QixDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7SUFDN0IsQ0FBQyxDQUFDO1NBQ0QsT0FBTyxDQUFDLENBQUMsV0FBbUIsRUFBRSxFQUFFOztRQUMvQixPQUFPLElBQUEsZ0JBQUMsRUFBQyxtQkFBbUIsQ0FBQzthQUMxQixNQUFNLENBQUMsQ0FBQyxZQUFZLEVBQUUsRUFBRTtZQUN2QixPQUFPLENBQ0wsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztnQkFDeEMsQ0FBQyxDQUFBLHlCQUF5QixhQUF6Qix5QkFBeUIsdUJBQXpCLHlCQUF5QixDQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQTtnQkFDL0QsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXO29CQUNwQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXLENBQUMsQ0FDekMsQ0FBQztRQUNKLENBQUMsQ0FBQzthQUNELEtBQUssQ0FDSixDQUFDLEVBQ0QsTUFBQSw0QkFBNEIsYUFBNUIsNEJBQTRCLHVCQUE1Qiw0QkFBNEIsQ0FBRSxHQUFHLENBQUMsV0FBVyxDQUFDLG1DQUFJLGFBQWEsQ0FDaEU7YUFDQSxLQUFLLEVBQUUsQ0FBQztJQUNiLENBQUMsQ0FBQztTQUNELE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztTQUN6QixLQUFLLEVBQUUsQ0FBQztJQUVYLGVBQWUsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO0lBRWhELE1BQU0sK0JBQStCLEdBQUcsSUFBQSxnQkFBQyxFQUFDLHFCQUFxQixDQUFDO1NBQzdELEdBQUcsQ0FBQyxDQUFDLFlBQVksRUFBRSxFQUFFO1FBQ3BCLE9BQU8sZUFBZSxJQUFJLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRTtZQUM5QyxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQ3hCLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztJQUM3QixDQUFDLENBQUM7U0FDRCxPQUFPLENBQUMsQ0FBQyxXQUFtQixFQUFFLEVBQUU7O1FBQy9CLE9BQU8sSUFBQSxnQkFBQyxFQUFDLG1CQUFtQixDQUFDO2FBQzFCLE1BQU0sQ0FBQyxDQUFDLFlBQVksRUFBRSxFQUFFO1lBQ3ZCLE9BQU8sQ0FDTCxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO2dCQUN4QyxDQUFDLENBQUEseUJBQXlCLGFBQXpCLHlCQUF5Qix1QkFBekIseUJBQXlCLENBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFBO2dCQUMvRCxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLFdBQVc7b0JBQ3BDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLFdBQVcsQ0FBQyxDQUN6QyxDQUFDO1FBQ0osQ0FBQyxDQUFDO2FBQ0QsS0FBSyxDQUNKLENBQUMsRUFDRCxNQUFBLDRCQUE0QixhQUE1Qiw0QkFBNEIsdUJBQTVCLDRCQUE0QixDQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsbUNBQUksYUFBYSxDQUNoRTthQUNBLEtBQUssRUFBRSxDQUFDO0lBQ2IsQ0FBQyxDQUFDO1NBQ0QsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1NBQ3pCLEtBQUssRUFBRSxDQUFDO0lBRVgsZUFBZSxDQUFDLCtCQUErQixDQUFDLENBQUM7SUFFakQsTUFBTSxhQUFhLEdBQUcsSUFBQSxnQkFBQyxFQUFDO1FBQ3RCLEdBQUcsb0JBQW9CO1FBQ3ZCLEdBQUcscUJBQXFCO1FBQ3hCLEdBQUcsa0JBQWtCO1FBQ3JCLEdBQUcscUJBQXFCO1FBQ3hCLEdBQUcsUUFBUTtRQUNYLEdBQUcsb0JBQW9CO1FBQ3ZCLEdBQUcscUJBQXFCO1FBQ3hCLEdBQUcsOEJBQThCO1FBQ2pDLEdBQUcsK0JBQStCO0tBQ25DLENBQUM7U0FDQyxPQUFPLEVBQUU7U0FDVCxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7U0FDekIsS0FBSyxFQUFFLENBQUM7SUFFWCxNQUFNLGNBQWMsR0FBRyxJQUFBLGdCQUFDLEVBQUMsYUFBYSxDQUFDO1NBQ3BDLE9BQU8sQ0FBQyxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1NBQzNFLE9BQU8sRUFBRTtTQUNULElBQUksRUFBRTtTQUNOLEtBQUssRUFBRSxDQUFDO0lBRVgsU0FBRyxDQUFDLElBQUksQ0FDTixlQUFlLGNBQWMsQ0FBQyxNQUFNLHNCQUFzQixhQUFhLENBQUMsTUFBTSw4QkFBOEIsQ0FDN0csQ0FBQztJQUVGLE1BQU0sYUFBYSxHQUFHLE1BQU0sYUFBYSxDQUFDLFNBQVMsQ0FBQyxjQUFjLEVBQUU7UUFDbEUsV0FBVztLQUNaLENBQUMsQ0FBQztJQUVILE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFpQixFQUFFLEVBQUU7O1FBQ2hELE9BQUEsR0FBRyxNQUFBLE1BQUEsYUFBYSxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLDBDQUFFLE1BQU0sbUNBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQ3BFLE1BQUEsTUFBQSxhQUFhLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsMENBQUUsTUFBTSxtQ0FBSSxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQ25FLElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO0tBQUEsQ0FBQztJQUVsQixTQUFHLENBQUMsSUFBSSxDQUNOO1FBQ0Usb0JBQW9CLEVBQUUsb0JBQW9CLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO1FBQ25FLHFCQUFxQixFQUFFLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztRQUNyRSxRQUFRLEVBQUUsUUFBUSxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztRQUMzQyxvQkFBb0IsRUFBRSxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7UUFDbkUscUJBQXFCLEVBQUUscUJBQXFCLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO1FBQ3JFLDhCQUE4QixFQUM1Qiw4QkFBOEIsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7UUFDekQsK0JBQStCLEVBQzdCLCtCQUErQixDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztRQUMxRCxjQUFjLEVBQUUsa0JBQWtCLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO1FBQzNELGdCQUFnQixFQUFFLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztLQUNqRSxFQUNELG9CQUFvQixDQUNyQixDQUFDO0lBRUYsTUFBTSxhQUFhLEdBQUcsZ0JBQUMsQ0FBQyxHQUFHLENBR3pCLGFBQWEsRUFBRSxDQUFDLFlBQVksRUFBRSxFQUFFO1FBQ2hDLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZFLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZFLElBQUksR0FBYyxDQUFDO1FBQ25CLElBQUk7WUFDRixHQUFHLEdBQUcsSUFBQSx3QkFBYyxFQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQztTQUM1QztRQUFDLE9BQU8sR0FBRyxFQUFFO1lBQ1osU0FBRyxDQUFDLElBQUksQ0FDTixFQUFFLFlBQVksRUFBRSxFQUNoQiwrQkFBK0IsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksWUFBWSxDQUFDLE9BQU8saUNBQWlDLENBQ3pJLENBQUM7WUFDRixPQUFPLFNBQVMsQ0FBQztTQUNsQjtRQUVELElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDdEIsU0FBRyxDQUFDLElBQUksQ0FDTiwrQkFBK0IsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQ25ELFlBQVksQ0FBQyxNQUFNLENBQUMsRUFDdEIsSUFBSSxHQUFHLFlBQ0wsTUFBTSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUN4RCw4QkFBOEIsQ0FDL0IsQ0FBQztZQUNGLE9BQU8sU0FBUyxDQUFDO1NBQ2xCO1FBRUQsT0FBTyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUM7SUFDL0IsQ0FBQyxDQUFDLENBQUM7SUFFSCxNQUFNLFVBQVUsR0FBRyxnQkFBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUU1QyxlQUFNLENBQUMsU0FBUyxDQUNkLG1CQUFtQixFQUNuQixJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsbUJBQW1CLEVBQ2hDLHlCQUFnQixDQUFDLFlBQVksQ0FDOUIsQ0FBQztJQUVGLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUVuQyxNQUFNLFlBQVksR0FBRyxNQUFNLFlBQVksQ0FBQyxRQUFRLENBQUMsVUFBVSxFQUFFO1FBQzNELFdBQVc7S0FDWixDQUFDLENBQUM7SUFFSCxlQUFNLENBQUMsU0FBUyxDQUNkLGFBQWEsRUFDYixJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsZUFBZSxFQUM1Qix5QkFBZ0IsQ0FBQyxZQUFZLENBQzlCLENBQUM7SUFFRixNQUFNLGdCQUFnQixHQUFzQztRQUMxRCxRQUFRLEVBQUUscUJBQVEsQ0FBQyxFQUFFO1FBQ3JCLFVBQVUsRUFBRTtZQUNWLG9CQUFvQjtZQUNwQixxQkFBcUI7WUFDckIsbUJBQW1CLEVBQUUsa0JBQWtCO1lBQ3ZDLHNCQUFzQixFQUFFLHFCQUFxQjtZQUM3QyxRQUFRO1lBQ1Isb0JBQW9CO1lBQ3BCLHFCQUFxQjtZQUNyQiw4QkFBOEI7WUFDOUIsK0JBQStCO1NBQ2hDO0tBQ0YsQ0FBQztJQUVGLE9BQU8sRUFBRSxZQUFZLEVBQUUsY0FBYyxFQUFFLGdCQUFnQixFQUFFLGFBQWEsRUFBRSxDQUFDO0FBQzNFLENBQUM7QUFuYUQsa0RBbWFDO0FBUU0sS0FBSyxVQUFVLG1CQUFtQixDQUFDLEVBQ3hDLE9BQU8sRUFDUCxRQUFRLEVBQ1IsU0FBUyxFQUNULGFBQWEsRUFDYixnQkFBZ0IsRUFDaEIsYUFBYSxFQUNiLFlBQVksRUFDWix3QkFBd0IsRUFDeEIsT0FBTyxHQUNtQjs7SUFDMUIsTUFBTSxFQUNKLFdBQVcsRUFDWCxlQUFlLEVBQUUsRUFDZixJQUFJLEVBQ0osZUFBZSxFQUNmLGNBQWMsRUFDZCxhQUFhLEVBQ2IseUJBQXlCLEVBQ3pCLHFCQUFxQixFQUNyQixpQkFBaUIsR0FDbEIsR0FDRixHQUFHLGFBQWEsQ0FBQztJQUNsQixNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ3JELE1BQU0sZUFBZSxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFdkQsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFFdkMsTUFBTSxXQUFXLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLFFBQVEsRUFBRTtRQUNyRSxXQUFXO0tBQ1osQ0FBQyxDQUFDO0lBRUgsZ0ZBQWdGO0lBQ2hGLDJGQUEyRjtJQUMzRixLQUFLLE1BQU0sSUFBSSxJQUFJLFdBQVcsRUFBRTtRQUM5QixJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUM5QyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztLQUMvQztJQUVELGVBQU0sQ0FBQyxTQUFTLENBQ2QscUJBQXFCLEVBQ3JCLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxtQkFBbUIsRUFDaEMseUJBQWdCLENBQUMsWUFBWSxDQUM5QixDQUFDO0lBRUYsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFFdkMsNENBQTRDO0lBQzVDLE1BQU0sbUJBQW1CLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRTlFLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztJQUU3QyxxR0FBcUc7SUFDckcsbUdBQW1HO0lBQ25HLDRGQUE0RjtJQUM1RixJQUFJLG1CQUFtQixHQUFxQixFQUFFLENBQUM7SUFDL0MsSUFBSSxlQUFlLEdBQUcsQ0FBQyxFQUFFO1FBQ3ZCLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLFlBQVksQ0FBQyxjQUFjLENBQ2pFLE9BQU8sRUFDUCxRQUFRLENBQ1QsQ0FBQztRQUVGLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUVsRCxtQkFBbUIsR0FBRztZQUNwQjtnQkFDRSxFQUFFLEVBQUUsV0FBVztnQkFDZixNQUFNLEVBQUU7b0JBQ04sRUFBRSxFQUFFLE1BQU0sQ0FBQyxPQUFPO2lCQUNuQjtnQkFDRCxNQUFNLEVBQUU7b0JBQ04sRUFBRSxFQUFFLE1BQU0sQ0FBQyxPQUFPO2lCQUNuQjtnQkFDRCxNQUFNLEVBQUUsS0FBSztnQkFDYixPQUFPLEVBQUUsS0FBSztnQkFDZCxVQUFVLEVBQUUsS0FBSyxFQUFFLHFDQUFxQzthQUN6RDtTQUNGLENBQUM7S0FDSDtJQUVELE1BQU0sV0FBVyxHQUFHLDhCQUF1QixDQUFDLE9BQU8sQ0FBRSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUU1RSxNQUFNLHVCQUF1QixHQUd6QixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ2QsTUFBTSx3QkFBd0IsR0FHMUIsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUVkLE1BQU0sVUFBVSxHQUFHLE1BQUEsaUJBQWlCLENBQUMsT0FBTyxDQUFDLG1DQUFJLEVBQUUsQ0FBQztJQUNwRCxNQUFNLG1CQUFtQixHQUFnQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBRW5ELFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUMzQixNQUFNLGFBQWEsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBRWxELG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUN2Qyx1QkFBdUIsQ0FBQyxHQUFHLENBQ3pCLGFBQWEsRUFDYixJQUFJLHlCQUF5QixDQUFpQixFQUFFLEVBQUUscUJBQXFCLENBQUMsQ0FDekUsQ0FBQztRQUNGLHdCQUF3QixDQUFDLEdBQUcsQ0FDMUIsYUFBYSxFQUNiLElBQUkseUJBQXlCLENBQWlCLEVBQUUsRUFBRSxxQkFBcUIsQ0FBQyxDQUN6RSxDQUFDO0lBQ0osQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLDhCQUE4QixHQUFHLENBQUMsQ0FBQztJQUN2QyxJQUFJLCtCQUErQixHQUFHLENBQUMsQ0FBQztJQUV4QyxnREFBZ0Q7SUFDaEQsc0VBQXNFO0lBQ3RFLElBQUksaUJBQWlCLEdBQUcsQ0FBQyxDQUFDO0lBQzFCLGdEQUFnRDtJQUNoRCxJQUNFLFFBQVEsQ0FBQyxNQUFNLElBQUksTUFBTTtRQUN6QixRQUFRLENBQUMsTUFBTSxJQUFJLE9BQU87UUFDMUIsUUFBUSxDQUFDLE1BQU0sSUFBSSxLQUFLLEVBQ3hCO1FBQ0EsNEVBQTRFO1FBQzVFLGlCQUFpQixHQUFHLENBQUMsQ0FBQztLQUN2QjtJQUVELE1BQU0sc0JBQXNCLEdBQXFCLEVBQUUsQ0FBQztJQUNwRCxNQUFNLG9CQUFvQixHQUFxQixFQUFFLENBQUM7SUFDbEQsTUFBTSxxQkFBcUIsR0FBcUIsRUFBRSxDQUFDO0lBQ25ELE1BQU0sUUFBUSxHQUFxQixFQUFFLENBQUM7SUFFdEMsNERBQTREO0lBQzVELElBQUkscUJBQXFCLEdBQUcsQ0FBQyxDQUFDO0lBRTlCLHFDQUFxQztJQUNyQyx5RkFBeUY7SUFDekYsS0FBSyxNQUFNLFlBQVksSUFBSSxtQkFBbUIsRUFBRTtRQUM5QyxxQkFBcUIsSUFBSSxDQUFDLENBQUM7UUFDM0IscUVBQXFFO1FBQ3JFLElBQ0UsOEJBQThCLElBQUksaUJBQWlCO1lBQ25ELCtCQUErQixJQUFJLGlCQUFpQjtZQUNwRCxzQkFBc0IsQ0FBQyxNQUFNLElBQUksaUJBQWlCO1lBQ2xELFFBQVEsQ0FBQyxNQUFNLElBQUksSUFBSTtZQUN2QixvQkFBb0IsQ0FBQyxNQUFNLElBQUksY0FBYztZQUM3QyxxQkFBcUIsQ0FBQyxNQUFNLElBQUksY0FBYyxFQUM5QztZQUNBLHdEQUF3RDtZQUN4RCxNQUFNO1NBQ1A7UUFFRCxJQUFJLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLEVBQUU7WUFDM0MsNkNBQTZDO1lBQzdDLFNBQVM7U0FDVjtRQUVELDBFQUEwRTtRQUMxRSxJQUFJLHdCQUF3QixFQUFFO1lBQzVCLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxpQkFBaUIsQ0FBQyxHQUFHLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQztnQkFDL0Qsd0JBQXdCLENBQUMsaUJBQWlCLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBQ2xFLHdCQUF3QixDQUFDLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2FBQ25FLENBQUMsQ0FBQztZQUVILElBQUksaUJBQWlCLElBQUksaUJBQWlCLEVBQUU7Z0JBQzFDLFNBQVM7YUFDVjtTQUNGO1FBRUQsTUFBTSxzQkFBc0IsR0FBRyx1QkFBdUIsQ0FBQyxHQUFHLENBQ3hELFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUN2QixDQUFDO1FBQ0YsSUFDRSw4QkFBOEIsR0FBRyxpQkFBaUI7WUFDbEQsc0JBQXNCO1lBQ3RCLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGVBQWU7WUFDekMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksY0FBYyxFQUN4QztZQUNBLDhCQUE4QixJQUFJLENBQUMsQ0FBQztZQUNwQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3hDLElBQUksb0JBQW9CLENBQUMsTUFBTSxHQUFHLGNBQWMsRUFBRTtnQkFDaEQsb0JBQW9CLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO2FBQ3pDO1lBQ0QsSUFDRSxTQUFTLEtBQUssb0JBQVMsQ0FBQyxZQUFZO2dCQUNwQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXLEVBQ3JDO2dCQUNBLHNCQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQzthQUMzQztZQUNELHNCQUFzQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDaEQsU0FBUztTQUNWO1FBRUQsTUFBTSxzQkFBc0IsR0FBRyx1QkFBdUIsQ0FBQyxHQUFHLENBQ3hELFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUN2QixDQUFDO1FBQ0YsSUFDRSw4QkFBOEIsR0FBRyxpQkFBaUI7WUFDbEQsc0JBQXNCO1lBQ3RCLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWM7WUFDeEMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksZUFBZSxFQUN6QztZQUNBLDhCQUE4QixJQUFJLENBQUMsQ0FBQztZQUNwQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3hDLElBQUksb0JBQW9CLENBQUMsTUFBTSxHQUFHLGNBQWMsRUFBRTtnQkFDaEQsb0JBQW9CLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO2FBQ3pDO1lBQ0QsSUFDRSxTQUFTLEtBQUssb0JBQVMsQ0FBQyxZQUFZO2dCQUNwQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXLEVBQ3JDO2dCQUNBLHNCQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQzthQUMzQztZQUNELHNCQUFzQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDaEQsU0FBUztTQUNWO1FBRUQsTUFBTSx1QkFBdUIsR0FBRyx3QkFBd0IsQ0FBQyxHQUFHLENBQzFELFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUN2QixDQUFDO1FBQ0YsSUFDRSwrQkFBK0IsR0FBRyxpQkFBaUI7WUFDbkQsdUJBQXVCO1lBQ3ZCLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWM7WUFDeEMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksZUFBZSxFQUN6QztZQUNBLCtCQUErQixJQUFJLENBQUMsQ0FBQztZQUNyQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3hDLElBQUkscUJBQXFCLENBQUMsTUFBTSxHQUFHLGNBQWMsRUFBRTtnQkFDakQscUJBQXFCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO2FBQzFDO1lBQ0QsSUFDRSxTQUFTLEtBQUssb0JBQVMsQ0FBQyxXQUFXO2dCQUNuQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXLEVBQ3JDO2dCQUNBLHNCQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQzthQUMzQztZQUNELHVCQUF1QixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDakQsU0FBUztTQUNWO1FBRUQsTUFBTSx1QkFBdUIsR0FBRyx3QkFBd0IsQ0FBQyxHQUFHLENBQzFELFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUN2QixDQUFDO1FBQ0YsSUFDRSwrQkFBK0IsR0FBRyxpQkFBaUI7WUFDbkQsdUJBQXVCO1lBQ3ZCLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGVBQWU7WUFDekMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksY0FBYyxFQUN4QztZQUNBLCtCQUErQixJQUFJLENBQUMsQ0FBQztZQUNyQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3hDLElBQUkscUJBQXFCLENBQUMsTUFBTSxHQUFHLGNBQWMsRUFBRTtnQkFDakQscUJBQXFCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO2FBQzFDO1lBQ0QsSUFDRSxTQUFTLEtBQUssb0JBQVMsQ0FBQyxXQUFXO2dCQUNuQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXLEVBQ3JDO2dCQUNBLHNCQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQzthQUMzQztZQUNELHVCQUF1QixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDakQsU0FBUztTQUNWO1FBRUQsNEVBQTRFO1FBQzVFLElBQ0Usc0JBQXNCLENBQUMsTUFBTSxHQUFHLGlCQUFpQjtZQUNqRCxDQUFDLENBQUMsU0FBUyxLQUFLLG9CQUFTLENBQUMsV0FBVztnQkFDbkMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLFdBQVc7b0JBQ3JDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGVBQWUsQ0FBQztvQkFDMUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXO3dCQUNwQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxlQUFlLENBQUMsQ0FBQyxDQUFDO2dCQUNoRCxDQUFDLFNBQVMsS0FBSyxvQkFBUyxDQUFDLFlBQVk7b0JBQ25DLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxXQUFXO3dCQUNyQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxjQUFjLENBQUM7d0JBQ3pDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksV0FBVzs0QkFDcEMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQ3BEO1lBQ0Esa0JBQWtCLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUN4QyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDMUMsU0FBUztTQUNWO1FBRUQsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLElBQUksRUFBRTtZQUMxQixrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3hDLFFBQVEsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDNUIsU0FBUztTQUNWO1FBRUQsSUFDRSxvQkFBb0IsQ0FBQyxNQUFNLEdBQUcsY0FBYztZQUM1QyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWM7Z0JBQ3ZDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWMsQ0FBQyxFQUMzQztZQUNBLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDeEMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQ3hDLFNBQVM7U0FDVjtRQUVELElBQ0UscUJBQXFCLENBQUMsTUFBTSxHQUFHLGNBQWM7WUFDN0MsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxlQUFlO2dCQUN4QyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxlQUFlLENBQUMsRUFDNUM7WUFDQSxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3hDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUN6QyxTQUFTO1NBQ1Y7S0FDRjtJQUVELGVBQU0sQ0FBQyxTQUFTLENBQ2QsaUNBQWlDLEVBQ2pDLHFCQUFxQixFQUNyQix5QkFBZ0IsQ0FBQyxLQUFLLENBQ3ZCLENBQUM7SUFFRixNQUFNLG9CQUFvQixHQUFxQixFQUFFLENBQUM7SUFDbEQsS0FBSyxNQUFNLDZCQUE2QixJQUFJLHVCQUF1QixDQUFDLE1BQU0sRUFBRSxFQUFFO1FBQzVFLG9CQUFvQixDQUFDLElBQUksQ0FBQyxHQUFHLDZCQUE2QixDQUFDLEtBQUssQ0FBQyxDQUFDO0tBQ25FO0lBRUQsTUFBTSxxQkFBcUIsR0FBcUIsRUFBRSxDQUFDO0lBQ25ELEtBQUssTUFBTSw4QkFBOEIsSUFBSSx3QkFBd0IsQ0FBQyxNQUFNLEVBQUUsRUFBRTtRQUM5RSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsR0FBRyw4QkFBOEIsQ0FBQyxLQUFLLENBQUMsQ0FBQztLQUNyRTtJQUVELGlDQUFpQztJQUNqQyxNQUFNLGlDQUFpQyxHQUduQyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ2QsTUFBTSxrQ0FBa0MsR0FHcEMsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNkLE1BQU0seUJBQXlCLEdBQUcsb0JBQW9CO1NBQ25ELE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFO1FBQ2Ysd0JBQXdCO1FBQ3hCLElBQUksY0FBYyxLQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFO1lBQ3JDLE9BQU8sQ0FBQyxDQUFBLHlCQUF5QixhQUF6Qix5QkFBeUIsdUJBQXpCLHlCQUF5QixDQUFFLFFBQVEsQ0FDekMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQzdCLENBQUEsQ0FBQztTQUNIO2FBQU07WUFDTCxPQUFPLENBQUMsQ0FBQSx5QkFBeUIsYUFBekIseUJBQXlCLHVCQUF6Qix5QkFBeUIsQ0FBRSxRQUFRLENBQ3pDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUM3QixDQUFBLENBQUM7U0FDSDtJQUNILENBQUMsQ0FBQztTQUNELEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQ1osY0FBYyxLQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQ3BFLENBQUM7SUFDSixNQUFNLDBCQUEwQixHQUFHLHFCQUFxQjtTQUNyRCxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRTtRQUNmLHdCQUF3QjtRQUN4QixJQUFJLGVBQWUsS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRTtZQUN0QyxPQUFPLENBQUMsQ0FBQSx5QkFBeUIsYUFBekIseUJBQXlCLHVCQUF6Qix5QkFBeUIsQ0FBRSxRQUFRLENBQ3pDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUM3QixDQUFBLENBQUM7U0FDSDthQUFNO1lBQ0wsT0FBTyxDQUFDLENBQUEseUJBQXlCLGFBQXpCLHlCQUF5Qix1QkFBekIseUJBQXlCLENBQUUsUUFBUSxDQUN6QyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FDN0IsQ0FBQSxDQUFDO1NBQ0g7SUFDSCxDQUFDLENBQUM7U0FDRCxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUNaLGVBQWUsS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUNyRSxDQUFDO0lBRUosS0FBSyxNQUFNLFdBQVcsSUFBSSx5QkFBeUIsRUFBRTtRQUNuRCxpQ0FBaUMsQ0FBQyxHQUFHLENBQ25DLFdBQVcsRUFDWCxJQUFJLHlCQUF5QixDQUFpQixFQUFFLEVBQUUsYUFBYSxDQUFDLENBQ2pFLENBQUM7S0FDSDtJQUNELEtBQUssTUFBTSxXQUFXLElBQUksMEJBQTBCLEVBQUU7UUFDcEQsa0NBQWtDLENBQUMsR0FBRyxDQUNwQyxXQUFXLEVBQ1gsSUFBSSx5QkFBeUIsQ0FBaUIsRUFBRSxFQUFFLGFBQWEsQ0FBQyxDQUNqRSxDQUFDO0tBQ0g7SUFFRCw2REFBNkQ7SUFDN0QsSUFBSSxzQkFBc0IsR0FBRyxDQUFDLENBQUM7SUFFL0IsSUFDRSx5QkFBeUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQztRQUNwQywwQkFBMEIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUNyQztRQUNBLEtBQUssTUFBTSxZQUFZLElBQUksbUJBQW1CLEVBQUU7WUFDOUMsc0JBQXNCLElBQUksQ0FBQyxDQUFDO1lBRTVCLElBQUksaUNBQWlDLEdBQUcsSUFBSSxDQUFDO1lBQzdDLEtBQUssTUFBTSxjQUFjLElBQUksaUNBQWlDLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQ3ZFLElBQUksQ0FBQyxjQUFjLENBQUMsY0FBYyxFQUFFLEVBQUU7b0JBQ3BDLGlDQUFpQyxHQUFHLEtBQUssQ0FBQztvQkFDMUMsTUFBTTtpQkFDUDthQUNGO1lBRUQsSUFBSSxrQ0FBa0MsR0FBRyxJQUFJLENBQUM7WUFDOUMsS0FBSyxNQUFNLGNBQWMsSUFBSSxrQ0FBa0MsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDeEUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxjQUFjLEVBQUUsRUFBRTtvQkFDcEMsa0NBQWtDLEdBQUcsS0FBSyxDQUFDO29CQUMzQyxNQUFNO2lCQUNQO2FBQ0Y7WUFFRCxJQUNFLGlDQUFpQztnQkFDakMsa0NBQWtDLEVBQ2xDO2dCQUNBLHdEQUF3RDtnQkFDeEQsTUFBTTthQUNQO1lBRUQsSUFBSSxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxFQUFFO2dCQUMzQyxTQUFTO2FBQ1Y7WUFFRCwwRUFBMEU7WUFDMUUsSUFBSSx3QkFBd0IsRUFBRTtnQkFDNUIsTUFBTSxDQUFDLGlCQUFpQixFQUFFLGlCQUFpQixDQUFDLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDO29CQUMvRCx3QkFBd0IsQ0FBQyxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztvQkFDbEUsd0JBQXdCLENBQUMsaUJBQWlCLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7aUJBQ25FLENBQUMsQ0FBQztnQkFFSCxJQUFJLGlCQUFpQixJQUFJLGlCQUFpQixFQUFFO29CQUMxQyxTQUFTO2lCQUNWO2FBQ0Y7WUFFRCxNQUFNLHNCQUFzQixHQUFHLGlDQUFpQyxDQUFDLEdBQUcsQ0FDbEUsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQ3ZCLENBQUM7WUFFRixJQUFJLHNCQUFzQixJQUFJLENBQUMsc0JBQXNCLENBQUMsY0FBYyxFQUFFLEVBQUU7Z0JBQ3RFLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ3hDLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7Z0JBQ2hELFNBQVM7YUFDVjtZQUVELE1BQU0sc0JBQXNCLEdBQUcsaUNBQWlDLENBQUMsR0FBRyxDQUNsRSxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FDdkIsQ0FBQztZQUVGLElBQUksc0JBQXNCLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxjQUFjLEVBQUUsRUFBRTtnQkFDdEUsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDeEMsc0JBQXNCLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztnQkFDaEQsU0FBUzthQUNWO1lBRUQsTUFBTSx1QkFBdUIsR0FBRyxrQ0FBa0MsQ0FBQyxHQUFHLENBQ3BFLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUN2QixDQUFDO1lBRUYsSUFDRSx1QkFBdUI7Z0JBQ3ZCLENBQUMsdUJBQXVCLENBQUMsY0FBYyxFQUFFLEVBQ3pDO2dCQUNBLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ3hDLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7Z0JBQ2pELFNBQVM7YUFDVjtZQUVELE1BQU0sdUJBQXVCLEdBQUcsa0NBQWtDLENBQUMsR0FBRyxDQUNwRSxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FDdkIsQ0FBQztZQUVGLElBQ0UsdUJBQXVCO2dCQUN2QixDQUFDLHVCQUF1QixDQUFDLGNBQWMsRUFBRSxFQUN6QztnQkFDQSxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUN4Qyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO2dCQUNqRCxTQUFTO2FBQ1Y7U0FDRjtLQUNGO0lBRUQsZUFBTSxDQUFDLFNBQVMsQ0FDZCxrQ0FBa0MsRUFDbEMsc0JBQXNCLEVBQ3RCLHlCQUFnQixDQUFDLEtBQUssQ0FDdkIsQ0FBQztJQUVGLE1BQU0sOEJBQThCLEdBQXFCLEVBQUUsQ0FBQztJQUM1RCxLQUFLLE1BQU0sY0FBYyxJQUFJLGlDQUFpQyxDQUFDLE1BQU0sRUFBRSxFQUFFO1FBQ3ZFLDhCQUE4QixDQUFDLElBQUksQ0FBQyxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQztLQUM5RDtJQUVELE1BQU0sK0JBQStCLEdBQXFCLEVBQUUsQ0FBQztJQUM3RCxLQUFLLE1BQU0sY0FBYyxJQUFJLGtDQUFrQyxDQUFDLE1BQU0sRUFBRSxFQUFFO1FBQ3hFLCtCQUErQixDQUFDLElBQUksQ0FBQyxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQztLQUMvRDtJQUVELE1BQU0sYUFBYSxHQUFHLElBQUEsZ0JBQUMsRUFBQztRQUN0QixHQUFHLG9CQUFvQjtRQUN2QixHQUFHLHFCQUFxQjtRQUN4QixHQUFHLG1CQUFtQjtRQUN0QixHQUFHLHNCQUFzQjtRQUN6QixHQUFHLFFBQVE7UUFDWCxHQUFHLG9CQUFvQjtRQUN2QixHQUFHLHFCQUFxQjtRQUN4QixHQUFHLDhCQUE4QjtRQUNqQyxHQUFHLCtCQUErQjtLQUNuQyxDQUFDO1NBQ0MsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1NBQ3pCLEtBQUssRUFBRSxDQUFDO0lBRVgsTUFBTSxpQkFBaUIsR0FBZ0IsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNqRCxLQUFLLE1BQU0sSUFBSSxJQUFJLGFBQWEsRUFBRTtRQUNoQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN0QyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztLQUN2QztJQUNELE1BQU0sY0FBYyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQztJQUVyRCxTQUFHLENBQUMsSUFBSSxDQUNOLGVBQWUsY0FBYyxDQUFDLE1BQU0sc0JBQXNCLGFBQWEsQ0FBQyxNQUFNLDhCQUE4QixDQUM3RyxDQUFDO0lBRUYsTUFBTSxhQUFhLEdBQUcsTUFBTSxhQUFhLENBQUMsU0FBUyxDQUFDLGNBQWMsRUFBRTtRQUNsRSxXQUFXO0tBQ1osQ0FBQyxDQUFDO0lBRUgsTUFBTSxtQkFBbUIsR0FBRyxDQUFDLENBQWlCLEVBQUUsRUFBRTs7UUFDaEQsT0FBQSxHQUFHLE1BQUEsTUFBQSxhQUFhLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsMENBQUUsTUFBTSxtQ0FBSSxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFDcEUsTUFBQSxNQUFBLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQywwQ0FBRSxNQUFNLG1DQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsRUFDbkUsRUFBRSxDQUFBO0tBQUEsQ0FBQztJQUVMLFNBQUcsQ0FBQyxJQUFJLENBQ047UUFDRSxvQkFBb0IsRUFBRSxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7UUFDbkUscUJBQXFCLEVBQUUscUJBQXFCLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO1FBQ3JFLFFBQVEsRUFBRSxRQUFRLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO1FBQzNDLG9CQUFvQixFQUFFLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztRQUNuRSxxQkFBcUIsRUFBRSxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7UUFDckUsOEJBQThCLEVBQzVCLDhCQUE4QixDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQztRQUN6RCwrQkFBK0IsRUFDN0IsK0JBQStCLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO1FBQzFELGNBQWMsRUFBRSxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7UUFDNUQsZ0JBQWdCLEVBQUUsc0JBQXNCLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO0tBQ2xFLEVBQ0Qsb0JBQW9CLENBQ3JCLENBQUM7SUFFRixNQUFNLGFBQWEsR0FBRyxnQkFBQyxDQUFDLEdBQUcsQ0FDekIsYUFBYSxFQUNiLENBQUMsWUFBWSxFQUFFLEVBQUU7UUFDZixNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsaUJBQWlCLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN2RSxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsaUJBQWlCLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUV2RSxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ3RCLFNBQUcsQ0FBQyxJQUFJLENBQ04sK0JBQStCLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLENBQ2xGLENBQUM7WUFDRixPQUFPLFNBQVMsQ0FBQztTQUNsQjtRQUVELE9BQU8sQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDMUIsQ0FBQyxDQUNGLENBQUM7SUFFRixNQUFNLFVBQVUsR0FBRyxnQkFBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUU1QyxlQUFNLENBQUMsU0FBUyxDQUNkLG1CQUFtQixFQUNuQixJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsbUJBQW1CLEVBQ2hDLHlCQUFnQixDQUFDLFlBQVksQ0FDOUIsQ0FBQztJQUVGLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUVuQyx3RUFBd0U7SUFDeEUscUZBQXFGO0lBQ3JGLE1BQU0sWUFBWSxHQUFHLE1BQU0sWUFBWSxDQUFDLFFBQVEsQ0FBQyxVQUFVLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFFNUUsZUFBTSxDQUFDLFNBQVMsQ0FDZCxhQUFhLEVBQ2IsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLGVBQWUsRUFDNUIseUJBQWdCLENBQUMsWUFBWSxDQUM5QixDQUFDO0lBRUYsTUFBTSxnQkFBZ0IsR0FBc0M7UUFDMUQsUUFBUSxFQUFFLHFCQUFRLENBQUMsRUFBRTtRQUNyQixVQUFVLEVBQUU7WUFDVixvQkFBb0I7WUFDcEIscUJBQXFCO1lBQ3JCLG1CQUFtQjtZQUNuQixzQkFBc0I7WUFDdEIsUUFBUTtZQUNSLG9CQUFvQjtZQUNwQixxQkFBcUI7WUFDckIsOEJBQThCO1lBQzlCLCtCQUErQjtTQUNoQztLQUNGLENBQUM7SUFFRixPQUFPLEVBQUUsWUFBWSxFQUFFLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSxhQUFhLEVBQUUsQ0FBQztBQUMzRSxDQUFDO0FBcmxCRCxrREFxbEJDO0FBU00sS0FBSyxVQUFVLDJCQUEyQixDQUFDLEVBQ2hELGdCQUFnQixFQUNoQixnQkFBZ0IsRUFDaEIsYUFBYSxFQUNiLGFBQWEsRUFDYixjQUFjLEVBQ2QsY0FBYyxHQUNvQjtJQUNsQyxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUN2QyxNQUFNLENBQ0osRUFBRSxhQUFhLEVBQUUsZUFBZSxFQUFFLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSxFQUNwRSxFQUFFLGFBQWEsRUFBRSxlQUFlLEVBQUUsY0FBYyxFQUFFLGdCQUFnQixFQUFFLEVBQ3JFLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0lBRXpDLGVBQU0sQ0FBQyxTQUFTLENBQ2Qsd0JBQXdCLEVBQ3hCLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxtQkFBbUIsRUFDaEMseUJBQWdCLENBQUMsWUFBWSxDQUM5QixDQUFDO0lBQ0YsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFFdkM7Ozs7O09BS0c7SUFDSCxnRkFBZ0Y7SUFDaEYsMkZBQTJGO0lBQzNGLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQy9CO1FBQ0UsR0FBRyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsb0JBQW9CO1FBQ25ELEdBQUcsZ0JBQWdCLENBQUMsVUFBVSxDQUFDLG9CQUFvQjtRQUNuRCxhQUFhO1FBQ2IsR0FBRyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMscUJBQXFCO1FBQ3BELEdBQUcsZ0JBQWdCLENBQUMsVUFBVSxDQUFDLHFCQUFxQjtRQUNwRCxnQkFBZ0I7UUFDaEIsR0FBRyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsbUJBQW1CO0tBQ25ELENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQzdCLENBQUM7SUFFRixNQUFNLHFCQUFxQixHQUFHLElBQUEsZ0JBQUMsRUFBQyxlQUFlLENBQUM7U0FDN0MsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1NBQ2hELE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO1NBQ2xDLEtBQUssRUFBRSxDQUFDO0lBRVgsOEVBQThFO0lBQzlFLE1BQU0sYUFBYSxHQUFHLElBQUEsZ0JBQUMsRUFBQyxlQUFlLENBQUM7U0FDckMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7U0FDOUIsS0FBSyxFQUFFLENBQUM7SUFFWCxpR0FBaUc7SUFDakcsTUFBTSxZQUFZLEdBQXFCLEVBQUUsQ0FBQztJQUMxQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxjQUFjLEVBQUUsRUFBRTtRQUMvQyxNQUFNLGNBQWMsR0FBRyxhQUFhLENBQUMsSUFBSSxDQUN2QyxDQUFDLElBQUksRUFBRSxFQUFFLENBQ1AsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLEVBQUU7WUFDekMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDN0MsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLEVBQUU7Z0JBQ3pDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQ2hELENBQUM7UUFFRixJQUFJLGNBQWMsRUFBRTtZQUNsQixJQUFJLGNBQWMsQ0FBQyxVQUFVLEdBQUcsY0FBYyxDQUFDLE1BQU0sRUFBRTtnQkFDckQsU0FBRyxDQUFDLElBQUksQ0FDTjtvQkFDRSxNQUFNLEVBQUUsY0FBYyxDQUFDLE1BQU0sQ0FBQyxFQUFFO29CQUNoQyxNQUFNLEVBQUUsY0FBYyxDQUFDLE1BQU0sQ0FBQyxFQUFFO29CQUNoQyxZQUFZLEVBQUUsY0FBYyxDQUFDLFVBQVU7b0JBQ3ZDLFFBQVEsRUFBRSxjQUFjLENBQUMsTUFBTTtpQkFDaEMsRUFDRCxxRkFBcUYsQ0FDdEYsQ0FBQztnQkFDRixZQUFZLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO2FBQ25DO1NBQ0Y7YUFBTTtZQUNMLFNBQUcsQ0FBQyxJQUFJLENBQ047Z0JBQ0UsTUFBTSxFQUFFLGNBQWMsQ0FBQyxNQUFNLENBQUMsRUFBRTtnQkFDaEMsTUFBTSxFQUFFLGNBQWMsQ0FBQyxNQUFNLENBQUMsRUFBRTtnQkFDaEMsWUFBWSxFQUFFLGNBQWMsQ0FBQyxVQUFVO2FBQ3hDLEVBQ0QsOERBQThELENBQy9ELENBQUM7WUFDRixZQUFZLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1NBQ25DO0lBQ0gsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFHLENBQUMsSUFBSSxDQUNOLFlBQVksQ0FBQyxNQUFNLEVBQ25CLHVEQUF1RCxDQUN4RCxDQUFDO0lBRUYsTUFBTSxhQUFhLEdBQUcsQ0FBQyxHQUFHLFlBQVksRUFBRSxHQUFHLGFBQWEsQ0FBQyxDQUFDO0lBRTFELE1BQU0sY0FBYyxHQUFHLElBQUEsZ0JBQUMsRUFBQyxhQUFhLENBQUM7U0FDcEMsT0FBTyxDQUFDLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7U0FDM0UsT0FBTyxFQUFFO1NBQ1QsSUFBSSxFQUFFO1NBQ04sS0FBSyxFQUFFLENBQUM7SUFFWCxTQUFHLENBQUMsSUFBSSxDQUNOLGVBQWUsY0FBYyxDQUFDLE1BQU0sc0JBQXNCLGFBQWEsQ0FBQyxNQUFNLDJCQUEyQixDQUMxRyxDQUFDO0lBRUYsTUFBTSxhQUFhLEdBQUcsTUFBTSxhQUFhLENBQUMsU0FBUyxDQUNqRCxjQUFjLEVBQ2QsYUFBYSxDQUNkLENBQUM7SUFFRixNQUFNLGVBQWUsR0FBRyxnQkFBQyxDQUFDLEdBQUcsQ0FHM0IsYUFBYSxFQUFFLENBQUMsWUFBWSxFQUFFLEVBQUU7UUFDaEMsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdkUsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdkUsSUFBSSxHQUFjLENBQUM7UUFDbkIsSUFBSTtZQUNGLEdBQUcsR0FBRyxJQUFBLHdCQUFjLEVBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1NBQzVDO1FBQUMsT0FBTyxHQUFHLEVBQUU7WUFDWixTQUFHLENBQUMsSUFBSSxDQUNOLEVBQUUsWUFBWSxFQUFFLEVBQ2hCLCtCQUErQixZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxZQUFZLENBQUMsT0FBTyxpQ0FBaUMsQ0FDekksQ0FBQztZQUNGLE9BQU8sU0FBUyxDQUFDO1NBQ2xCO1FBRUQsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUN0QixTQUFHLENBQUMsSUFBSSxDQUNOLCtCQUErQixZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFDbkQsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUN0QixJQUFJLEdBQUcsWUFDTCxNQUFNLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQ3hELDhCQUE4QixDQUMvQixDQUFDO1lBQ0YsT0FBTyxTQUFTLENBQUM7U0FDbEI7UUFFRCxPQUFPLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQztJQUMvQixDQUFDLENBQUMsQ0FBQztJQUVILE1BQU0sWUFBWSxHQUFHLGdCQUFDLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0lBRWhELE1BQU0sZUFBZSxHQUFHLGdCQUFDLENBQUMsR0FBRyxDQUMzQixZQUFZLEVBQ1osQ0FBQyxZQUFZLEVBQUUsRUFBRTtRQUNmLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZFLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBRXZFLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDdEIsU0FBRyxDQUFDLElBQUksQ0FDTiwrQkFBK0IsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FDbEYsQ0FBQztZQUNGLE9BQU8sU0FBUyxDQUFDO1NBQ2xCO1FBRUQsT0FBTyxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUMxQixDQUFDLENBQ0YsQ0FBQztJQUVGLE1BQU0sWUFBWSxHQUFHLGdCQUFDLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0lBRWhELGVBQU0sQ0FBQyxTQUFTLENBQ2Qsc0JBQXNCLEVBQ3RCLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxtQkFBbUIsRUFDaEMseUJBQWdCLENBQUMsWUFBWSxDQUM5QixDQUFDO0lBRUYsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRW5DLE1BQU0sQ0FBQyxjQUFjLEVBQUUsY0FBYyxDQUFDLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDO1FBQ3pELGNBQWMsQ0FBQyxRQUFRLENBQUMsWUFBWSxFQUFFLGFBQWEsQ0FBQztRQUNwRCxjQUFjLENBQUMsUUFBUSxDQUFDLFlBQVksRUFBRSxhQUFhLENBQUM7S0FDckQsQ0FBQyxDQUFDO0lBRUgsZUFBTSxDQUFDLFNBQVMsQ0FDZCxnQkFBZ0IsRUFDaEIsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLGVBQWUsRUFDNUIseUJBQWdCLENBQUMsWUFBWSxDQUM5QixDQUFDO0lBRUYsa0hBQWtIO0lBQ2xILHdGQUF3RjtJQUN4RixNQUFNLHFCQUFxQixHQUFHLENBQUMsR0FBbUMsRUFBRSxFQUFFO1FBQ3BFLE9BQU87WUFDTCxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUM5QixnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FDcEU7WUFDRCxHQUFHLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUM7U0FDcEMsQ0FBQztJQUNKLENBQUMsQ0FBQztJQUVGLE1BQU0sZ0JBQWdCLEdBQXNDO1FBQzFELFFBQVEsRUFBRSxxQkFBUSxDQUFDLEtBQUs7UUFDeEIsVUFBVSxFQUFFO1lBQ1Ysb0JBQW9CLEVBQUUscUJBQXFCLENBQUMsc0JBQXNCLENBQUM7WUFDbkUscUJBQXFCLEVBQUUscUJBQXFCLENBQUMsdUJBQXVCLENBQUM7WUFDckUsbUJBQW1CLEVBQUUscUJBQXFCLENBQUMscUJBQXFCLENBQUM7WUFDakUsc0JBQXNCLEVBQUUscUJBQXFCLENBQUMsd0JBQXdCLENBQUM7WUFDdkUsUUFBUSxFQUFFLHFCQUFxQixDQUFDLFVBQVUsQ0FBQztZQUMzQyxvQkFBb0IsRUFBRSxxQkFBcUIsQ0FBQyxzQkFBc0IsQ0FBQztZQUNuRSxxQkFBcUIsRUFBRSxxQkFBcUIsQ0FBQyx1QkFBdUIsQ0FBQztZQUNyRSw4QkFBOEIsRUFBRSxxQkFBcUIsQ0FDbkQsZ0NBQWdDLENBQ2pDO1lBQ0QsK0JBQStCLEVBQUUscUJBQXFCLENBQ3BELGlDQUFpQyxDQUNsQztTQUNGO0tBQ0YsQ0FBQztJQUVGLE9BQU87UUFDTCxjQUFjO1FBQ2QsY0FBYztRQUNkLGNBQWMsRUFBRSxnQkFBZ0I7UUFDaEMsYUFBYTtLQUNkLENBQUM7QUFDSixDQUFDO0FBek5ELGtFQXlOQyJ9