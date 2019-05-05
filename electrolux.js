'use strict';

class AuthError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AuthError';
    }
  }

module.exports.AuthError = AuthError;

module.exports.ElectroluxDeltaApi = (function() {
    const fetch = require("node-fetch");
    const MyMilaApi = require("./mymila").MyMilaApi;

    const BASE_URI = "https://api.delta.electrolux.com/api/"

    let auth_state = {
        mmsToken: "",
        userToken: "",
        username: "",
        password: ""
    }

    async function refreshMmsToken() {
        const token = await MyMilaApi.getInitialToken()
        return token.mms_access_token
    }

    async function refreshUserToken() {
        auth_state.mmsToken = await refreshMmsToken()
        const response = await fetch(BASE_URI + "Accounts/Login", {
            method: "POST",
            body: JSON.stringify({
                userName: auth_state.username,
                password: auth_state.password,
                mmsToken: auth_state.mmsToken
            }),
            headers: { 'Content-Type': 'application/json' }
        })
        if(response.status == 200) {
            auth_state.userToken = await response.text()
        } else if(response.status == 400) {
            throw new AuthError("Invalid username/password")
        }
    }

    async function fetchApi(suffix, options) {
        if(!options) options = {}
        if(!options.headers) options.headers = {}
        for(var i = 0; i < 3; ++i) {
            if(auth_state.userToken) {
                options.headers.Authorization = "Bearer " + auth_state.userToken
            }
            const response = await fetch(BASE_URI + suffix, options)
            if(response.status == 200) {
                return await response.json()
            } else if(response.status >= 400 && response.status < 500) {
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
            return await fetchApi("Appliances")
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
