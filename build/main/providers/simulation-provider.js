"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Simulator = exports.SimulationStatus = void 0;
const sdk_core_1 = require("@uniswap/sdk-core");
const universal_router_sdk_1 = require("@uniswap/universal-router-sdk");
const ethers_1 = require("ethers/lib/ethers");
const routers_1 = require("../routers");
const Erc20__factory_1 = require("../types/other/factories/Erc20__factory");
const Permit2__factory_1 = require("../types/other/factories/Permit2__factory");
const util_1 = require("../util");
var SimulationStatus;
(function (SimulationStatus) {
    SimulationStatus[SimulationStatus["NotSupported"] = 0] = "NotSupported";
    SimulationStatus[SimulationStatus["Failed"] = 1] = "Failed";
    SimulationStatus[SimulationStatus["Succeeded"] = 2] = "Succeeded";
    SimulationStatus[SimulationStatus["InsufficientBalance"] = 3] = "InsufficientBalance";
    SimulationStatus[SimulationStatus["NotApproved"] = 4] = "NotApproved";
})(SimulationStatus = exports.SimulationStatus || (exports.SimulationStatus = {}));
/**
 * Provider for dry running transactions.
 *
 * @export
 * @class Simulator
 */
class Simulator {
    /**
     * Returns a new SwapRoute with simulated gas estimates
     * @returns SwapRoute
     */
    constructor(provider, portionProvider, chainId) {
        this.chainId = chainId;
        this.provider = provider;
        this.portionProvider = portionProvider;
    }
    async simulate(fromAddress, swapOptions, swapRoute, amount, quote, providerConfig) {
        const neededBalance = swapRoute.trade.tradeType == sdk_core_1.TradeType.EXACT_INPUT ? amount : quote;
        if ((neededBalance.currency.isNative && this.chainId == sdk_core_1.ChainId.MAINNET) ||
            (await this.userHasSufficientBalance(fromAddress, swapRoute.trade.tradeType, amount, quote))) {
            util_1.log.info('User has sufficient balance to simulate. Simulating transaction.');
            try {
                return this.simulateTransaction(fromAddress, swapOptions, swapRoute, providerConfig);
            }
            catch (e) {
                util_1.log.error({ e }, 'Error simulating transaction');
                return Object.assign(Object.assign({}, swapRoute), { simulationStatus: SimulationStatus.Failed });
            }
        }
        else {
            util_1.log.error('User does not have sufficient balance to simulate.');
            return Object.assign(Object.assign({}, swapRoute), { simulationStatus: SimulationStatus.InsufficientBalance });
        }
    }
    async userHasSufficientBalance(fromAddress, tradeType, amount, quote) {
        try {
            const neededBalance = tradeType == sdk_core_1.TradeType.EXACT_INPUT ? amount : quote;
            let balance;
            if (neededBalance.currency.isNative) {
                balance = await this.provider.getBalance(fromAddress);
            }
            else {
                const tokenContract = Erc20__factory_1.Erc20__factory.connect(neededBalance.currency.address, this.provider);
                balance = await tokenContract.balanceOf(fromAddress);
            }
            const hasBalance = balance.gte(ethers_1.BigNumber.from(neededBalance.quotient.toString()));
            util_1.log.info({
                fromAddress,
                balance: balance.toString(),
                neededBalance: neededBalance.quotient.toString(),
                neededAddress: neededBalance.wrapped.currency.address,
                hasBalance,
            }, 'Result of balance check for simulation');
            return hasBalance;
        }
        catch (e) {
            util_1.log.error(e, 'Error while checking user balance');
            return false;
        }
    }
    async checkTokenApproved(fromAddress, inputAmount, swapOptions, provider) {
        // Check token has approved Permit2 more than expected amount.
        const tokenContract = Erc20__factory_1.Erc20__factory.connect(inputAmount.currency.wrapped.address, provider);
        if (swapOptions.type == routers_1.SwapType.UNIVERSAL_ROUTER) {
            const permit2Allowance = await tokenContract.allowance(fromAddress, universal_router_sdk_1.PERMIT2_ADDRESS);
            // If a permit has been provided we don't need to check if UR has already been allowed.
            if (swapOptions.inputTokenPermit) {
                util_1.log.info({
                    permitAllowance: permit2Allowance.toString(),
                    inputAmount: inputAmount.quotient.toString(),
                }, 'Permit was provided for simulation on UR, checking that Permit2 has been approved.');
                return permit2Allowance.gte(ethers_1.BigNumber.from(inputAmount.quotient.toString()));
            }
            // Check UR has been approved from Permit2.
            const permit2Contract = Permit2__factory_1.Permit2__factory.connect(universal_router_sdk_1.PERMIT2_ADDRESS, provider);
            const { amount: universalRouterAllowance, expiration: tokenExpiration } = await permit2Contract.allowance(fromAddress, inputAmount.currency.wrapped.address, (0, util_1.SWAP_ROUTER_02_ADDRESSES)(this.chainId));
            const nowTimestampS = Math.round(Date.now() / 1000);
            const inputAmountBN = ethers_1.BigNumber.from(inputAmount.quotient.toString());
            const permit2Approved = permit2Allowance.gte(inputAmountBN);
            const universalRouterApproved = universalRouterAllowance.gte(inputAmountBN);
            const expirationValid = tokenExpiration > nowTimestampS;
            util_1.log.info({
                permitAllowance: permit2Allowance.toString(),
                tokenAllowance: universalRouterAllowance.toString(),
                tokenExpirationS: tokenExpiration,
                nowTimestampS,
                inputAmount: inputAmount.quotient.toString(),
                permit2Approved,
                universalRouterApproved,
                expirationValid,
            }, `Simulating on UR, Permit2 approved: ${permit2Approved}, UR approved: ${universalRouterApproved}, Expiraton valid: ${expirationValid}.`);
            return permit2Approved && universalRouterApproved && expirationValid;
        }
        else if (swapOptions.type == routers_1.SwapType.SWAP_ROUTER_02) {
            if (swapOptions.inputTokenPermit) {
                util_1.log.info({
                    inputAmount: inputAmount.quotient.toString(),
                }, 'Simulating on SwapRouter02 info - Permit was provided for simulation. Not checking allowances.');
                return true;
            }
            const allowance = await tokenContract.allowance(fromAddress, (0, util_1.SWAP_ROUTER_02_ADDRESSES)(this.chainId));
            const hasAllowance = allowance.gte(ethers_1.BigNumber.from(inputAmount.quotient.toString()));
            util_1.log.info({
                hasAllowance,
                allowance: allowance.toString(),
                inputAmount: inputAmount.quotient.toString(),
            }, `Simulating on SwapRouter02 - Has allowance: ${hasAllowance}`);
            // Return true if token allowance is greater than input amount
            return hasAllowance;
        }
        throw new Error(`Unsupported swap type ${swapOptions}`);
    }
}
exports.Simulator = Simulator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2ltdWxhdGlvbi1wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9wcm92aWRlcnMvc2ltdWxhdGlvbi1wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxnREFBdUQ7QUFDdkQsd0VBQWdFO0FBQ2hFLDhDQUE4QztBQUU5Qyx3Q0FLb0I7QUFDcEIsNEVBQXlFO0FBQ3pFLGdGQUE2RTtBQUM3RSxrQ0FBd0U7QUFjeEUsSUFBWSxnQkFNWDtBQU5ELFdBQVksZ0JBQWdCO0lBQzFCLHVFQUFnQixDQUFBO0lBQ2hCLDJEQUFVLENBQUE7SUFDVixpRUFBYSxDQUFBO0lBQ2IscUZBQXVCLENBQUE7SUFDdkIscUVBQWUsQ0FBQTtBQUNqQixDQUFDLEVBTlcsZ0JBQWdCLEdBQWhCLHdCQUFnQixLQUFoQix3QkFBZ0IsUUFNM0I7QUFFRDs7Ozs7R0FLRztBQUNILE1BQXNCLFNBQVM7SUFJN0I7OztPQUdHO0lBQ0gsWUFDRSxRQUF5QixFQUN6QixlQUFpQyxFQUN2QixPQUFnQjtRQUFoQixZQUFPLEdBQVAsT0FBTyxDQUFTO1FBRTFCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxDQUFDO0lBQ3pDLENBQUM7SUFFTSxLQUFLLENBQUMsUUFBUSxDQUNuQixXQUFtQixFQUNuQixXQUF3QixFQUN4QixTQUFvQixFQUNwQixNQUFzQixFQUN0QixLQUFxQixFQUNyQixjQUF1QztRQUV2QyxNQUFNLGFBQWEsR0FDakIsU0FBUyxDQUFDLEtBQUssQ0FBQyxTQUFTLElBQUksb0JBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBQ3RFLElBQ0UsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsT0FBTyxJQUFJLGtCQUFPLENBQUMsT0FBTyxDQUFDO1lBQ3BF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