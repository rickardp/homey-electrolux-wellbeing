'use strict';

class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}

module.exports.AuthError = AuthError;

module.exports.ElectroluxDeltaApi = (function () {
    const fetch = require("node-fetch");
    const Homey = require('homey');

    const BASE_URI = "https://api.delta.electrolux.com/api/"
    const CLIENT_VERSION = "1.8.16400";
    const CLIENT_SECRET = Homey.env.WELLBEING_CLIENT_SECRET

    let auth_state = {
        clientToken: "",
        userToken: "",
        username: "",
        password: ""
    }

    async function checkForUpdate() {
        const response = await (await fetch(BASE_URI + "updates/Wellbeing", {
            method: "POST",
            body: JSON.stringify({
                Version: CLIENT_VERSION,
                Platform: "iOS"
            }),
            headers: { 'Content-Type': 'application/json' }
        })).json()
        if (response.forceUpdate === undefined) {
            console.log("Invalid response from update server")
        }
        if (response.forceUpdate) {
            console.log("Back-end API needs to be updated")
        }
    }

    async function refreshClientToken() {
        await checkForUpdate()
        const response = await (await fetch(BASE_URI + "Clients/Wellbeing", {
            method: "POST",
            body: JSON.stringify({
                ClientSecret: CLIENT_SECRET
            }),
            headers: { 'Content-Type': 'application/json' }
        })).json()
        if (!response.accessToken) {
            throw new AuthError("Error refreshing client token: " + response.codeDescription)
        }
        auth_state.clientToken = response.accessToken
    }

    async function refreshUserToken() {
        await refreshClientToken()
        const response = await (await fetch(BASE_URI + "Users/Login", {
            method: "POST",
            body: JSON.stringify({
                userName: auth_state.username,
                password: auth_state.password
            }),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + auth_state.clientToken
            }
        })).json()
        if (!response.accessToken) {
            throw new AuthError("Login error: " + response.codeDescription)
        }
        auth_state.userToken = response.accessToken
    }

    async function fetchApi(suffix, options) {
        if (!options) options = {}
        if (!options.headers) options.headers = {}
        for (var i = 0; i < 3; ++i) {
            if (auth_state.userToken) {
                options.headers.Authorization = "Bearer " + auth_state.userToken
            }
            const response = await fetch(BASE_URI + suffix, options)
            if (response.status == 200) {
                return await response.json()
            } else if (response.status >= 400 && response.status < 500) {
                console.log("Error: " + response.status)
                await refreshUserToken()
            } else {
                throw new Error("Internal server error: " + response.status)
            }
        }
        throw new Error("Internal error. Too many authentication attempts")
    }

    class ElectroluxDeltaApi {
        setToken(token) {
            auth_state.userToken = token
        }

        async verifyCredentials() {
            await refreshUserToken()
        }

        setAuth(username, password) {
            auth_state.username = username
            auth_state.password = password
            auth_state.mmsToken = ""
            auth_state.userToken = ""
        }

        async getAppliances() {
            return await fetchApi("Domains/Appliances")
        }

        async getAppliance(pncId) {
            return await fetchApi("Appliances/" + pncId)
        }

        async sendDeviceCommand(id, command) {
            return await fetchApi("Appliances/" + id + "/Commands", {
                method: "PUT",
                body: JSON.stringify(command),
                headers: { 'Content-Type': 'application/json' }
            })
        }
    }

    return ElectroluxDeltaApi
})()
