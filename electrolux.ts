import Homey from 'homey';
import fetch from 'node-fetch';
import {GigyaAuthSession} from "./gigyaAuthSession";


/**
 * Represents an authentication error.
 * @class
 * @extends Error
 */
export class AuthError extends Error {
    constructor(message : string) {
        super(message);
        this.name = 'AuthError';
    }
}

const OCP_TOKEN_URL = "https://api.ocp.electrolux.one/one-account-authorization/api/v1/token";
const API_URL =  "/appliance/api/v2/appliances";
const CLIENT_ID = Homey.env.CLIENT_ID;
const X_API_KEY = Homey.env.ELECTROLUX_X_API_KEY;

export class ElectroluxApi {
    log: (message: string) => void;
    auth_state = {
        accessToken: "",
        exchangeToken: "",
        expiresAt: null as Date|null,
        username: "",
        password: "",
        countryCode: "",
        failTime: null as number | null,
        sessionToken: "",
        sessionSecret: "",
    }
    base_url = "";

    constructor(log: (message: string) => void) {
        this.log = log;
    }

    async authenticateUser() {
        let gigyaAuthSession = new GigyaAuthSession(this.log);
        let token = await gigyaAuthSession.getToken(this.auth_state.username, this.auth_state.password);
        this.base_url = gigyaAuthSession.getApiBaseUrlForUser() // e.g. https://api.eu.ocp.electrolux.one in europe
        return token;
    }

    async exchangeToken() {
        // Before we can get a token from Electrolux' API, we need to get a token from their Gigya instance to talk with their API
        let gigyaAuthJwtToken = await this.authenticateUser();

        let body = JSON.stringify({
            clientId: CLIENT_ID,
            idToken: gigyaAuthJwtToken,
            grantType: "urn:ietf:params:oauth:grant-type:token-exchange"
        });
        this.log(body)
        const tokenExchangeResponse = await fetch(OCP_TOKEN_URL, {
            method: "POST",
            headers: { 
                'Content-Type': 'application/json',
                'Origin-Country-Code': this.auth_state.countryCode,
                'X-Api-Key': X_API_KEY
            },
            body: body
        });

        const exchangeData = await tokenExchangeResponse.json();
        if (!exchangeData.accessToken) {
            throw new AuthError("Error exchanging token");
        }

        
        this.auth_state.exchangeToken = exchangeData.accessToken;
        this.auth_state.expiresAt = new Date(new Date().getTime() + exchangeData.expiresIn * 1000);
    }

    handleError(error : Error) {
        this.auth_state.failTime = Date.now();
        throw error;
    }
    
    async fetchApi(suffix : string, method = 'GET', body? : string) {    
        if (!this.auth_state.exchangeToken || !this.auth_state.expiresAt || new Date() >= this.auth_state.expiresAt) {
            await this.exchangeToken();
        }
        
        this.log(`fetchApi(${suffix}, ${method}, ${body})`);


        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.auth_state.exchangeToken}`,
                'x-api-key': X_API_KEY
            },
            body : undefined as string|undefined
        };
        
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        try {
            const response = await fetch( this.base_url + API_URL + suffix, options);
            const responseBody = await response.text();

            if (!response.ok) {
                this.log(`API request to ${suffix} failed with status: ${response.status}`);
                this.log(`API response body: ${responseBody}`);
                this.handleError(new Error(`API request failed: ${response.status} ${response.statusText}`));
                return;
            }
        
            return responseBody ? JSON.parse(responseBody) : null;

            } catch (error) {
                this.log(`Error in fetchApi: ${error}`);
                this.handleError(error as Error);
            }
    }

    setAuth(username : string, password : string) {
        this.auth_state.username = username;
        this.auth_state.password = password;
    }    
   
    async getAppliances() : Promise<any> {
        try {
            return await this.fetchApi('/', 'GET');
        } catch (error) {
            this.log(`Error fetching appliances: ${error}`);
            throw error; // Re-throw error for further handling
        }
    }

    async getAppliance(pncId : string) {
        try {
            if (!pncId) {
                throw new Error("Missing device ID");
            }
            return await this.fetchApi(`/${pncId}`, 'GET');
        } catch (error) {
            this.log(`Error fetching appliance with ID ${pncId}: ${error}`);
            throw error; // Re-throw error for further handling
        }
    }

    async sendDeviceCommand(deviceId : string, command : any) {
        const suffix = `/${deviceId}/command`;   
        try {
            await this.fetchApi(`${suffix}`, 'PUT', command);
        } catch (error) {
            this.log(`Error sending command to device ID: ${deviceId}: ${error}`);
        }
    }
}
