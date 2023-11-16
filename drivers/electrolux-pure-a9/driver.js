'use strict';

const Homey = require('homey');
const { ElectroluxApi } = require('../../electrolux');

class ElectroluxPureDriver extends Homey.Driver {

    onInit() {
        this.log('ElectroluxPureDriver has been initialized');

        this.registerFlowCardAction('set_fan_speed');
        this.registerFlowCardAction('enable_smart_mode');
        this.registerFlowCardAction('enable_manual_mode');
        this.registerFlowCardAction('enable_ionizer');
        this.registerFlowCardAction('disable_ionizer');
        this.registerFlowCardAction('enable_lock');
        this.registerFlowCardAction('disable_lock');
        this.registerFlowCardAction('enable_indicator_light');
        this.registerFlowCardAction('disable_indicator_light');
    }

    registerFlowCardAction(cardName) {
        const card = this.homey.flow.getActionCard(cardName);
        card.registerRunListener((args, state) => {
            return args.device['flow_' + cardName](args, state);
        });
    }

    async onPair(session) {
        let api = new ElectroluxApi();

        session.setHandler('login', async (data) => {
            const { username, password } = data;
            api.setAuth(username, password);

            try {
                await api.exchangeToken();
                return true; 
            } catch (error) {
                this.log('Login failed:', error);
                throw new Error('Login failed'); 
            }
        });

        session.setHandler('list_devices', async (data) => {
            try {
                const appliances = await api.getAppliances();
                console.log(appliances);
                return appliances.map(appliance => {
                    return {
                        name: appliance.applianceData.applianceName,
                        data: { id: appliance.applianceId },
                        settings: { username: api.auth_state.username, password: api.auth_state.password }
                    };
                });
            } catch (error) {
                this.log('Error listing devices:', error);
                throw new Error('Failed to list devices');
            }
        });
    }
}

module.exports = ElectroluxPureDriver;