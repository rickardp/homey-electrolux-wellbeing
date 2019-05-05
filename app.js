'use strict';

const Homey = require('homey');

class ElectroluxPureApp extends Homey.App {
	
	onInit() {
		this.log('ElectroluxPureApp is running...');
	}
	
}

module.exports = ElectroluxPureApp;