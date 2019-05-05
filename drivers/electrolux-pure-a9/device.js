'use strict';

const Homey = require('homey')
const ElectroluxDeltaApi = require('../../electrolux').ElectroluxDeltaApi

let apis = {}

const POLL_INTERVAL = 60000.0
const BACKOFF_POLL_COUNT = 15

class ElectroluxPureDevice extends Homey.Device {
	
	onInit() {
		this.log('ElectroluxPureDevice has been inited')
		setTimeout(this.onPoll.bind(this), 500)
		setInterval(this.onPoll.bind(this), POLL_INTERVAL)
		let dev = this
		this.registerMultipleCapabilityListener([ 'onoff', 'FAN_speed', 'SMART_mode', 'IONIZER_onoff' ], ( valueObj, optsObj ) => {
			this.log('Setting caps', valueObj);
			return dev.setDeviceOpts.bind(dev)(valueObj)
		  }, 500);
	}

	async setDeviceOpts(valueObj) {
		const deviceId = this.getData().id
		const client = this.getApi()
		if(valueObj.onoff !== undefined) {
			this.log("onoff: " + valueObj.onoff)
			await client.sendDeviceCommand(deviceId, {
				workMode: valueObj.onoff ? (valueObj.SMART_mode == "manual" ? "Manual" : "Auto") : "PowerOff"
			})
		}
		if(valueObj.SMART_mode !== undefined && valueObj.onoff === undefined) {
			this.log("SMART_mode: " + valueObj.SMART_mode)
			await client.sendDeviceCommand(deviceId, {
				workMode: valueObj.SMART_mode == "manual" ? "Manual" : "Auto"
			})
		}
		if(valueObj.IONIZER_onoff !== undefined) {
			this.log("IONIZER_onoff: " + valueObj.IONIZER_onoff)
			await client.sendDeviceCommand(deviceId, {
				ionizer: valueObj.IONIZER_onoff
			})
		}
		if(valueObj.FAN_speed !== undefined) {
			let fanSpeed = Math.floor(0.1 * valueObj.FAN_speed - 1)
			if(fanSpeed < 1) fanSpeed = 1
			if(valueObj.FAN_speed <= 0) {
				await client.sendDeviceCommand(deviceId, {
					workMode: "PowerOff"
				})
			} else {
				this.log("FAN_speed: " + fanSpeed)
				await client.sendDeviceCommand(deviceId, {
					workMode: "Manual",
					fanspeed: fanSpeed
				})
			}
		}
		setTimeout(this.onPoll.bind(this), 500)
	}

	getApi() {
		const settings = this.getSettings()
		var client = apis[settings.username]
		if(!client) {
			this.log("Creating new API object for account " + settings.username)
			client = apis[settings.username] = new ElectroluxDeltaApi()
			client.setAuth(settings.username, settings.password)
			client.lastPoll = 0
			client.failTime = 0
		}
		return client
	}

	async onPoll() {
		const deviceId = this.getData().id
		if(!deviceId) return
		this.log("Polling for device " + deviceId)
		const settings = this.getSettings()
		if(!settings.username) {
			this.log("Device is not configured")
			return;
		}
		const client = this.getApi()
		let now = Date.now()
		if((now - client.failTime) < (POLL_INTERVAL * BACKOFF_POLL_COUNT)) {
			this.log("In failure back-off status")
			return
		}
		try {
			if(now - client.lastPoll > (POLL_INTERVAL * 0.5)) {
				this.log("Will poll account " + settings.username + " for appliance status")
				client.appliances = await client.getAppliances()
			}
			// this.log(await client.appliances)
		} catch (err) {
			this.log("Error: " + err)
			client.failTime = now
			return
		}
		if(client.appliances) {
			var appliance = null
			for(let i = 0; i < client.appliances.length; ++i) {
				if(client.appliances[i].pncId == deviceId) {
					appliance = client.appliances[i]
					break
				}
			}
			if(!appliance) {
				this.log("Device " + deviceId + " no longer found in account")
				this.setUnavailable("Device no longer in account. Check the mobile app and verfy that you use the correct account.")
			} else if(!appliance.twin) {
				this.log("Device " + deviceId + " missing required data")
				this.setUnavailable("Device has no data. Check for service outages.")
			} else if(appliance.twin.connectionState != "Connected") {
				this.log("Device " + deviceId + " is not connected")
				this.setUnavailable("Device is not connected. Check device power and Wi-Fi connectivity.")
			} else if(!appliance.twin.properties || !appliance.twin.properties.reported) {
				this.log("Device " + deviceId + " missing propertied data")
				this.setUnavailable("Device has no properties data. Check for service outages.")
			} else {
				this.setAvailable()
				this.updateAppliance(appliance)
			}
		}
	}

	updateAppliance(appliance) {
		this.log("Updating appliance " + appliance.twin.deviceId)
		const props = appliance.twin.properties.reported
		//console.log(appliance.twin.properties.reported)
		
		this.setCapabilityValue('measure_co2', props.CO2)
		this.setCapabilityValue('measure_humidity', props.Humidity)
		this.setCapabilityValue('measure_pm25', props.PM2_5)
		this.setCapabilityValue('measure_pm10', props.PM10)
		//this.setCapabilityValue('measure_pm1', props.PM1)
		this.setCapabilityValue('measure_voc', props.TVOC)
		this.setCapabilityValue('measure_luminance', props.EnvLightLvl) // Mapping formula?
		this.setCapabilityValue('measure_temperature', props.Temp)
		
		if(props.Workmode == 'Auto') {
			this.setCapabilityValue('onoff', true)
			this.setCapabilityValue('SMART_mode', 'smart')
			this.setCapabilityValue('FAN_speed', 10.0 * (props.Fanspeed + 1))
		} else if(props.Workmode == 'Manual') {
			this.setCapabilityValue('onoff', true)
			this.setCapabilityValue('SMART_mode', 'manual')
			this.setCapabilityValue('FAN_speed', 10.0 * (props.Fanspeed + 1))
		} else /* if(props.Workmode == 'PowerOff')*/ {
			this.setCapabilityValue('onoff', false)
			this.setCapabilityValue('FAN_speed', 0)
		}
		this.setCapabilityValue('IONIZER_onoff', props.Ionizer)
	}
	
}

module.exports = ElectroluxPureDevice;