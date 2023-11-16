'use strict';

const fetch = require("node-fetch");
const config = require('./config');


/**
 * Represents an authentication error.
 * @class
 * @extends Error
 */
class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthError';
    }
}


/**
 * Represents the Electrolux API.
 */
class ElectroluxApi {
    /**
     * Constructs a new ElectroluxApi object.
     * @constructor
     */
    constructor() {
        // Initializes the API URLs and credentials.
        this.BASE_URL = "https://api.ocp.electrolux.one/";
        this.TOKEN_URL = this.BASE_URL + "one-account-authorization/api/v1/token";
        this.AUTHENTICATION_URL = this.BASE_URL + "one-account-authentication/api/v1/authenticate";
        this.API_URL = this.BASE_URL + "appliance/api/v2/appliances";
        this.CLIENT_ID = config.CLIENT_ID;
        this.CLIENT_SECRET = config.CLIENT_SECRET;
        this.X_API_KEY = config.X_API_KEY;

        // Initializes the authentication state.
        this.auth_state = {
            accessToken: "",
            idToken: "",
            exchangeToken: "",
            expiresAt: null,
            username: "",
            password: "",
            countryCode: "",
            failTime: null
        };
    }

    /**
     * Obtains an access token using the client credentials grant type.
     * @throws {AuthError} If an authentication error occurs.
     * @returns {Promise<void>} A promise that resolves when the access token is obtained.
     */
    async getAccessToken() {
        const tokenResponse = await fetch(this.TOKEN_URL, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: this.CLIENT_ID,
                clientSecret: this.CLIENT_SECRET,
                grantType: "client_credentials"
            })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.accessToken) {
            throw new AuthError("Error obtaining client token");
        }

        this.auth_state.accessToken = tokenData.accessToken;
    }

    /**
     * Authenticates the user by obtaining an access token and exchanging it for an idToken.
     * @throws {AuthError} If an authentication error occurs.
     * @returns {Promise<void>} A promise that resolves when the authentication is successful.
     */
    async authenticateUser() {
        await this.getAccessToken();
        const loginResponse = await fetch(this.AUTHENTICATION_URL, {
            method: "POST",
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.auth_state.accessToken}`,
                'x-api-key': this.X_API_KEY
            },
            body: JSON.stringify({
                username: this.auth_state.username,
                password: this.auth_state.password
            })
        });

        const loginData = await loginResponse.json();
        if (!loginData.idToken) {
            throw new AuthError("Error obtaining user idToken");
        }

        this.auth_state.idToken = loginData.idToken;
        this.auth_state.countryCode = loginData.countryCode;
    }

    /**
     * Exchanges the user's idToken for an access token using the token exchange grant type.
     * @throws {AuthError} If an authentication error occurs.
     * @throws {Error} If an error occurs while exchanging the token.
     * @returns {Promise<void>} A promise that resolves when the token exchange is successful.
     */
    async exchangeToken() {
        await this.authenticateUser();
        const tokenExchangeResponse = await fetch(this.TOKEN_URL, {
            method: "POST",
            headers: { 
                'Content-Type': 'application/json',
                'Origin-Country-Code': this.auth_state.countryCode
            },
            body: JSON.stringify({
                clientId: this.CLIENT_ID,
                idToken: this.auth_state.idToken,
                grantType: "urn:ietf:params:oauth:grant-type:token-exchange"
            })
        });

        const exchangeData = await tokenExchangeResponse.json();
        if (!exchangeData.accessToken) {
            throw new AuthError("Error exchanging token");
        }

        
        this.auth_state.exchangeToken = exchangeData.accessToken;
        this.auth_state.expiresAt = new Date(new Date().getTime() + exchangeData.expiresIn * 1000);
    }

    /**
     * Handles an error by updating the authentication state and throwing the error.
     * @param {Error} error - The error to handle.
     * @throws {Error} The original error that was thrown.
     */
    handleError(error) {
        this.auth_state.failTime = Date.now();
        throw error;
    }
    
    /**
     * Fetches data from the Electrolux API.
     * @param {string} suffix - The API endpoint to fetch data from.
     * @param {string} method - The HTTP method to use for the request. Defaults to 'GET'.
     * @param {Object} body - The request body to send with the request. Defaults to null.
     * @throws {AuthError} If an authentication error occurs.
     * @throws {Error} If an error occurs while fetching data from the API.
     * @returns {Promise<Object>} A promise that resolves with the response data from the API.
     */
    async fetchApi(suffix, method = 'GET', body = null) {    
        if (!this.auth_state.exchangeToken || new Date() >= this.auth_state.expiresAt) {
            await this.exchangeToken();
        }


        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.auth_state.exchangeToken}`,
                'x-api-key': this.X_API_KEY
            }
        };
        
        
        if (body) {
            options.body = JSON.stringify(body);
         }

        try {
            const response = await fetch(this.API_URL + suffix, options);
            const responseBody = await response.text(); // Henter responsen som tekst én gang

            if (!response.ok) {
                console.error(`API request failed with status: ${response.status}`);
                console.error(`API response body: ${responseBody}`);
                this.handleError(new Error(`API request failed: ${response.status} ${response.statusText}`));
                return;
            }
        
            return responseBody ? JSON.parse(responseBody) : null; // Forenklet returhåndtering

            } catch (error) {
                // Håndterer feil
                console.error(`Error in fetchApi: ${error}`);
                this.handleError(error);
            }
    }

    /**
     * Sets the authentication credentials for the Electrolux API.
     * @param {string} username - The username to use for authentication.
     * @param {string} password - The password to use for authentication.
     */
    setAuth(username, password) {
        this.auth_state.username = username;
        this.auth_state.password = password;
    }    
   
    /**
     * Fetches all appliances.
     * @throws {Error} If an error occurs while fetching the appliances.
     * @returns {Promise<Object>} A promise that resolves with an array of appliance objects.
     */
    async getAppliances() {
        try {
            return await this.fetchApi('/', 'GET');
        } catch (error) {
            this.log(`Error fetching appliances: ${error}`);
            throw error; // Re-throw error for further handling
        }
    }

    /**
     * Fetches an appliance with the specified PNC ID.
     * @param {string} pncId - The PNC ID of the appliance to fetch.
     * @throws {Error} If an error occurs while fetching the appliance.
     * @returns {Promise<Object>} A promise that resolves with the appliance object.
     */
    async getAppliance(pncId) {
        try {
            return await this.fetchApi(`/${pncId}`, 'GET');
        } catch (error) {
            this.log(`Error fetching appliance with ID ${pncId}: ${error}`);
            throw error; // Re-throw error for further handling
        }
    }

    /**
     * Logs a message to the console.
     * @param {string} message - The message to log.
     */
    log(message) {
        console.log(message); // Eller bruk en annen logge-mekanisme etter behov
    }


    /**
     * Sends a command to a device with the specified ID.
     * @param {string} deviceId - The ID of the device to send the command to.
     * @param {Object} command - The command to send to the device.
     * @throws {Error} If an error occurs while sending the command.
     */
    async sendDeviceCommand(deviceId, command) {
        const suffix = `/${deviceId}/command`;   
        try {
            await this.fetchApi(`${suffix}`, 'PUT', command);
        } catch (error) {
            this.log(`Error sending command to device ID: ${deviceId}: ${error}`);
        }
    }
}

module.exports = { ElectroluxApi, AuthError };