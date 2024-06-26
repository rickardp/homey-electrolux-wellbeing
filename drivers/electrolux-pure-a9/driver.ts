import Homey from "homey";
import { ElectroluxApi } from "../../electrolux";
import { PairSession } from "homey/lib/Driver";

class ElectroluxPureDriver extends Homey.Driver {
  async onInit() {
    this.log("ElectroluxPureDriver has been initialized");

    this.registerFlowCardAction("set_fan_speed");
    this.registerFlowCardAction("enable_smart_mode");
    this.registerFlowCardAction("enable_manual_mode");
    this.registerFlowCardAction("enable_ionizer");
    this.registerFlowCardAction("disable_ionizer");
    this.registerFlowCardAction("enable_lock");
    this.registerFlowCardAction("disable_lock");
    this.registerFlowCardAction("enable_indicator_light");
    this.registerFlowCardAction("disable_indicator_light");
  }

  registerFlowCardAction(cardName: string) {
    const card = this.homey.flow.getActionCard(cardName);
    card.registerRunListener((args, state) => {
      return args.device["flow_" + cardName](args, state);
    });
  }

  async onPair(session: PairSession) {
    let api = new ElectroluxApi(this.log);

    session.setHandler("login", async (data) => {
      const { username, password } = data;
      api.setAuth(username, password);

      try {
        await api.exchangeToken();
        return true;
      } catch (error) {
        this.log("Login failed:", error);
        throw new Error("Login failed");
      }
    });

    session.setHandler("list_devices", async (data) => {
      try {
        const appliances = await api.getAppliances();
        console.log(appliances);
        return appliances.map((appliance: any) => {
          return {
            name: appliance.applianceData.applianceName,
            data: { id: appliance.applianceId },
            settings: {
              username: api.auth_state.username,
              password: api.auth_state.password,
            },
          };
        });
      } catch (error) {
        this.log("Error listing devices:", error);
        throw new Error("Failed to list devices");
      }
    });
  }
}

module.exports = ElectroluxPureDriver;
