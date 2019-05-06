'use strict';

const Homey = require('homey');
const ElectroluxDeltaApi = require('../../electrolux').ElectroluxDeltaApi;

class ElectroluxPureDriver extends Homey.Driver {
	
	onInit() {
		this.log('ElectroluxPureDriver has been inited');
	}
	
    onPair( socket ) {
		let username = '';
		let password = '';
		let api = new ElectroluxDeltaApi();
  
		socket.on('login', ( data, callback ) => {
			username = data.username;
			password = data.password;
  
			api.setAuth(username, password)

			api.verifyCredentials()
				.then(credentialsAreValid => {
					callback( null, true );
			  	}).catch(err => {
					if(err.name == 'AuthError') {
						callback( null, false );
					} else {
						callback(err);
					}
			  	});
		});
  
		socket.on('list_devices', ( data, callback ) => {
  
			api.getAppliances()
				.then(appliances => {
					console.log(appliances);
					const devices = appliances.map(appliance => {
						return {
							name: appliance.applianceData.applianceName,
							data: {
								id: appliance.pncId
							},
							settings: {
								username,
								password
							},
							icon: '/icon.svg'
						};
					});
					callback(null, devices);
				})
		});
	  }
}

module.exports = ElectroluxPureDriver;