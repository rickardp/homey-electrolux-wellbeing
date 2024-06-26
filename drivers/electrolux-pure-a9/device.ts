import Homey, { Api } from "homey";
import { ElectroluxApi } from "../../electrolux";

let apis: { [x: string]: ElectroluxApiClient } = {};

const POLL_INTERVAL = 100000.0; //Was 60000.0
const BACKOFF_POLL_COUNT = 5; //Was 15

interface ElectroluxApiClient {
  api: ElectroluxApi;
  lastPoll: number;
  failTime: number;
  appliances: any;
}

class ElectroluxPureDevice extends Homey.Device {
  isDeleted: boolean = false;

  async onInit() {
    this.log("ElectroluxPureDevice has been initialized");
    setTimeout(this.onPoll.bind(this), 500);
    setInterval(this.onPoll.bind(this), POLL_INTERVAL);

    // Add missing capabilities when upgrading
    for (const cap of ["LIGHT_onoff", "LOCK_onoff"]) {
      if (!this.hasCapability(cap)) {
        this.log("Migrating device from old version: Adding capability " + cap);
        await this.addCapability(cap);
      }
    }
    for (const cap of ["measure_luminance"]) {
      if (this.hasCapability(cap)) {
        this.log(
          "Migrating device from old version: Removing capability " + cap
        );
        await this.removeCapability(cap);
      }
    }

    // Listen to multiple capabilities simultaneously
    this.registerMultipleCapabilityListener(
      [
        "onoff",
        "FAN_speed",
        "SMART_mode",
        "IONIZER_onoff",
        "LIGHT_onoff",
        "LOCK_onoff",
      ],
      (valueObj, optsObj) => this.setDeviceOpts(valueObj),
      500
    );
  }

  onDeleted() {
    this.isDeleted = true;
  }

  async setDeviceOpts(valueObj: { [x: string]: any }) {
    const deviceId = this.getData().id;
    const client = this.getApi();

    try {
      // Get the current status of the device
      const deviceStatus = await client.api.getAppliance(deviceId);

      // Update WorkMode based on onoff and SMART_mode
      if (valueObj.onoff !== undefined) {
        this.log("onoff: " + valueObj.onoff);
        const workMode = valueObj.onoff
          ? valueObj.SMART_mode === "manual"
            ? "Manual"
            : "Auto"
          : "PowerOff";
        await client.api.sendDeviceCommand(deviceId, { WorkMode: workMode });
        this.log(`WorkMode command sent: ${workMode}`);
      }

      // Update SMART_mode
      if (valueObj.SMART_mode !== undefined && valueObj.onoff === undefined) {
        this.log("SMART_mode: " + valueObj.SMART_mode);
        const workMode = valueObj.SMART_mode === "manual" ? "Manual" : "Auto";
        await client.api.sendDeviceCommand(deviceId, { WorkMode: workMode });
        this.log(`SMART_mode command sent: ${workMode}`);
      }

      const commandMapping: { [x: string]: string } = {
        LIGHT_onoff: "UILight",
        LOCK_onoff: "SafetyLock",
        IONIZER_onoff: "Ionizer",
        FAN_speed: "Fanspeed",
      };

      // Update other capabilities
      const capabilitiesToUpdate = [
        "LIGHT_onoff",
        "LOCK_onoff",
        "IONIZER_onoff",
        "FAN_speed",
      ];
      for (const cap of capabilitiesToUpdate) {
        if (valueObj[cap] !== undefined) {
          const apiCommandName = commandMapping[cap] || cap; // Translates to API command names from homey to electrolux

          if (cap === "FAN_speed") {
            // Check if the device is in 'Smart' mode
            if (deviceStatus.Workmode === "Smart" && valueObj.FAN_speed) {
              // Send error to user
              // Code unknown
              return;
            } else {
              await client.api.sendDeviceCommand(deviceId, {
                [apiCommandName]: valueObj[cap] / 10,
              });
              this.log(`${cap}: ${valueObj[cap] / 10}`);
            }
          } else {
            await client.api.sendDeviceCommand(deviceId, {
              [apiCommandName]: valueObj[cap],
            });
            this.log(`${cap}: ${valueObj[cap]}`);
          }
        }
      }
    } catch (error) {
      this.log(`Error in setDeviceOpts: ${error}`);
    }

    setTimeout(this.onPoll.bind(this), 500);
  }

  getApi() {
    const settings = this.getSettings();
    let client = apis[settings.username];
    if (!client) {
      this.log("Creating new API object for account " + settings.username);
      client = {
        api: new ElectroluxApi(this.log),
        appliances: null,
        failTime: 0,
        lastPoll: 0,
      } as ElectroluxApiClient;
      client.api.setAuth(settings.username, settings.password);
      apis[settings.username] = client;
    }
    return client;
  }

  /**
   * Polls for the device's appliance status and updates the device accordingly.
   * If the device is deleted or not configured, the function returns without doing anything.
   * If the device is in failure back-off status, the function returns without doing anything.
   * If the device's appliance is found, the device is set as available and the appliance is updated.
   * If the device's appliance is not found, the device is set as unavailable and an error message is displayed.
   */
  async onPoll() {
    if (this.isDeleted) return;
    const deviceId = this.getData().id;
    if (!deviceId) return;
    this.log("Polling for device " + deviceId);
    const settings = this.getSettings();
    if (!settings.username) {
      this.log("Device is not configured");
      return;
    }
    const client = this.getApi();
    let now = Date.now();
    if (now - client.failTime < POLL_INTERVAL * BACKOFF_POLL_COUNT) {
      this.log("In failure back-off status");
      return;
    }
    try {
      if (now - client.lastPoll > POLL_INTERVAL * 0.5) {
        this.log(
          "Will poll account " + settings.username + " for appliance status"
        );
        client.appliances = await client.api.getAppliances();
      }
    } catch (err) {
      this.log("Error: " + err);
      client.failTime = now;
      return;
    }
    if (client.appliances) {
      let appliance = await client.api.getAppliance(deviceId);
      if (!appliance) {
        this.log("Device " + deviceId + " no longer found in account");
        this.setUnavailable(
          "Device no longer in account. Check the mobile app and verify that you use the correct account."
        );
      } else {
        this.setAvailable();
        this.updateAppliance(appliance);
      }
    }
  }

  async updateAppliance(appliance: any) {
    if (!appliance || appliance.length === 0) {
      this.log("No data received from device");
      return;
    }

    const deviceData = appliance;
    if (!deviceData.properties || !deviceData.properties.reported) {
      this.log("Device data is missing or incomplete");
      return;
    }

    const props = deviceData.properties.reported;
    this.log("Updating appliance: " + deviceData.applianceId);

    try {
      await this.setCapabilityValue("measure_voc", props.TVOC);
      await this.setCapabilityValue("measure_co2", props.ECO2);
      await this.setCapabilityValue("measure_humidity", props.Humidity);
      await this.setCapabilityValue("measure_pm25", props.PM2_5);
      await this.setCapabilityValue("measure_pm10", props.PM10);
      await this.setCapabilityValue("measure_pm1", props.PM1);
      await this.setCapabilityValue("measure_temperature", props.Temp);
      await this.setCapabilityValue("measure_FILTER", props.FilterLife);
      await this.log("Device data updated");
    } catch (error) {
      this.log("Error updating device state: ", error);
    }

    if (props.Workmode === "Auto") {
      this.setCapabilityValue("onoff", true);
      this.setCapabilityValue("SMART_mode", "smart");
      this.setCapabilityValue("FAN_speed", 10.0 * (props.Fanspeed + 1));
    } else if (props.Workmode === "Manual") {
      this.setCapabilityValue("onoff", true);
      this.setCapabilityValue("SMART_mode", "manual");
      this.setCapabilityValue("FAN_speed", 10.0 * (props.Fanspeed + 1));
    } else {
      this.setCapabilityValue("onoff", false);
      this.setCapabilityValue("FAN_speed", 0);
    }

    this.setCapabilityValue("IONIZER_onoff", props.Ionizer);
    this.setCapabilityValue("LIGHT_onoff", props.UILight);
    this.setCapabilityValue("LOCK_onoff", props.SafetyLock);
  }

  flow_set_fan_speed(args: { fan_speed: number }, state: {}) {
    return this.setDeviceOpts({ FAN_speed: args.fan_speed });
  }

  flow_enable_manual_mode(args: {}, state: {}) {
    return this.setDeviceOpts({ SMART_mode: "manual" });
  }

  flow_enable_smart_mode(args: {}, state: {}) {
    return this.setDeviceOpts({ SMART_mode: "smart" });
  }

  flow_enable_ionizer(args: {}, state: {}) {
    return this.setDeviceOpts({ IONIZER_onoff: true });
  }

  flow_disable_ionizer(args: {}, state: {}) {
    return this.setDeviceOpts({ IONIZER_onoff: false });
  }

  flow_enable_indicator_light(args: {}, state: {}) {
    return this.setDeviceOpts({ LIGHT_onoff: true });
  }

  flow_disable_indicator_light(args: {}, state: {}) {
    return this.setDeviceOpts({ LIGHT_onoff: false });
  }

  flow_enable_lock(args: {}, state: {}) {
    return this.setDeviceOpts({ LOCK_onoff: true });
  }

  flow_disable_lock(args: {}, state: {}) {
    return this.setDeviceOpts({ LOCK_onoff: false });
  }
}

module.exports = ElectroluxPureDevice;
