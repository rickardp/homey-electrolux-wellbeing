'use strict';

module.exports.MyMilaApi = (function() {
    const fetch = require("node-fetch");

    const BASE_URI = "https://api.mymila.co/mms/clients/elux/"
    class MyMilaApi {
        async getInitialToken() {
            const APP_CREDENTIALS = JSON.stringify({
                username: "elux_himalaya",
                password: "Anma32KamsLasm*272!!asiiAn2wuwqpslMm"
            })
            const response = await fetch(BASE_URI + "auth", {
                method: "POST",
                body: APP_CREDENTIALS,
                headers: { 'Content-Type': 'application/json' }
            });
            const responseObject = await response.json()
            return responseObject
        }
    }

    return new MyMilaApi()
})()
