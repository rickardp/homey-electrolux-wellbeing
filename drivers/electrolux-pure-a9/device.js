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
		let now = Date.now()
		var client = apis[settings.username]
		if(!client) {
			this.log("Creating new API object for account " + settings.username)
			client = apis[settings.username] = new ElectroluxDeltaApi()
			client.setAuth(settings.username, settings.password)
			client.lastPoll = 0
			client.failTime = 0
		}
		if((now - client.failTime) < (POLL_INTERVAL * BACKOFF_POLL_COUNT)) {
			this.log("In failure back-off status")
			return
		}
		try {
			if(now - client.lastPoll > (POLL_INTERVAL * 0.5)) {
				this.log("Will poll account " + settings.username + " for appliance status")
				client.appliances = await client.getAppliances()
			}
			this.log(await client.appliances)
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
		this.setCapabilityValue('measure_temperature', props.Temp)
		
		if(props.Workmode == 'Auto') {
			this.setCapabilityValue('onoff', true)
			this.setCapabilityValue('SMART_mode', 'smart')
		} else if(props.Workmode == 'Manual') {
			this.setCapabilityValue('onoff', true)
			this.setCapabilityValue('SMART_mode', 'manual')
		} else /* if(props.Workmode == 'PowerOff')*/ {
			this.setCapabilityValue('onoff', false)
		}
		this.setCapabilityValue('FAN_speed', 10.0 * (props.Fanspeed + 1))
		this.setCapabilityValue('IONIZER_onoff', props.Ionizer)
	}
	
}

module.exports = ElectroluxPureDevice;