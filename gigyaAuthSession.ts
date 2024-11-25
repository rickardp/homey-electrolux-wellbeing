import {randomInt} from "node:crypto";
import fetch from "node-fetch";
import {AuthError} from "./electrolux";
import {URLSearchParams} from "node:url";
import Homey from "homey";

const crypto = require('crypto');

const CLIENT_ID = Homey.env.CLIENT_ID;
const CLIENT_SECRET = Homey.env.CLIENT_SECRET;
const ELECTROLUX_X_API_KEY = Homey.env.ELECTROLUX_X_API_KEY;
const GIGYA_GLOBAL_API_KEY = Homey.env.GIGYA_GLOBAL_API_KEY;

// these two electrolux URLs are global, a regional url is fetched through the login process
const ELECTROLUX_TOKEN_URL = "https://api.ocp.electrolux.one/one-account-authorization/api/v1/token"
const ELECTROLUX_GIGYA_APIKEY_URL = "https://api.ocp.electrolux.one/one-account-user/api/v1/identity-providers?brand=electrolux&countryCode="
// The login url also has a regional URL, but it's nice if we can avoid asking the user for their region
const GIGYA_AUTH_URL = "https://accounts.global.gigya.com/accounts.login" // Global, since we need to obtain the country here
// These urls go to regional gigya datacenters. Global may work as well, but it's likely more robust to do this right and use regional urls
const GIGYA_TOKEN_URL = "https://accounts.GIGYA_DOMAIN/accounts.getJWT" // GIGYA_DOMAIN will be replaced during runtime by the regional domain name (this.gigyaDomain)
const GIGYA_SOCIALIZE_GMID_URL = "https://socialize.GIGYA_DOMAIN/socialize.getIDs" // GIGYA_DOMAIN will be replaced during runtime by the regional domain name (this.gigyaDomain)

export class GigyaAuthSession {
    private log;

    private gigyaApiKey = "";

    private gmid = "";
    private ucid = "";
    private gmidRefreshTime = 0;

    private electroluxAccessToken = "";
    private electroluxAccessTokenRefreshTime = 0;

    private electroluxRegionalBaseUrl = ""; // eg https://api.eu.ocp.electrolux.one
    private gigyaDomain: string | undefined = undefined;
    private countryCode: string | undefined = undefined;

    public constructor(log: (message: string) => void) {
        this.log = log;
    }

    public async getToken(email: string, password: string): Promise<string> {
        let session = await this.loginCreateSession(email, password)
        return this.getJwtToken(session.sessionToken, session.sessionSecret);
    }

    public async loginCreateSession(email: string, password: string): Promise<{
        sessionToken: string,
        sessionSecret: string
    }> {
        // GMID and ucid are not required at this moment. Should they become required, then we need to ask the user for their country code so we can load gmid, ucid, and the correct api key needed to access gcid and ucid identfiers
        //await this.createGmidUcid()

        let body = new URLSearchParams({
            loginID: email,
            password: password,
            apiKey: GIGYA_GLOBAL_API_KEY, // by using a hardcoded api key which works for the global endpoint, the user doesn't have to provide the country code themselves. Otherwise the gigya api key needs to be loaded first, requiring a country code
            format: "json",
            gmid: "", // this.gmid,
            nonce: this.createNonce(),
            httpStatusCodes: 'false',
            targetEnv: 'mobile',
            ucid: "", // this.ucid,
            sdk: 'Android_7.0.11',
        }).toString();

        this.log("Logging in: " + GIGYA_AUTH_URL)
        const loginResponse = await fetch(GIGYA_AUTH_URL, {
            method: "POST",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Apikey': GIGYA_GLOBAL_API_KEY,
            },
            body: body
        });

        const loginData = await loginResponse.json();
        if (loginData.statusCode != 200 || !loginData.sessionInfo.sessionToken) {
            throw new AuthError("Error obtaining user session, reason: " + loginData.statusCode + " " + loginData.statusReason);
        }
        // loginData.profile.country
        // SessionToken is to be used as oauth_token in the next request where id_token is obtained
        this.countryCode = loginData.profile.country;
        this.log("Detected country code " + this.countryCode)
        return loginData.sessionInfo;
    }

    private async getJwtToken(sessionToken: string, sessionSecret: string): Promise<string> {
        await this.createGmidUcid()

        if (!this.gigyaDomain) {
            this.log("!!! A gigya api key and domain should be obtained before trying to create a JWT token identifier")
            throw new AuthError("Incorrect auth flow");
        }

        let url = GIGYA_TOKEN_URL.replace("GIGYA_DOMAIN", this.gigyaDomain);
        // timestamp, nonce and sig are added during signing
        let payload = this.getSignedBodyString("POST", url,
            {
                fields: "country",
                apiKey: this.gigyaApiKey,
                format: "json",
                gmid: this.gmid,
                httpStatusCodes: "false",
                oauth_token: sessionToken,
                sdk: "Android_7.0.11",
                targetEnv: "mobile",
                ucid: this.ucid
            }, sessionSecret);


        this.log("Fetching JWT token: " + url)
        const tokenExchangeResponse = await fetch(url, {
            method: "POST",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Apikey': this.gigyaApiKey,
            },
            body: new URLSearchParams(payload).toString()
        });

        const exchangeData = await tokenExchangeResponse.json();

        if (!exchangeData.id_token) {
            throw new AuthError("Error exchanging token (JWT): " + exchangeData.statusCode + " " + exchangeData.statusReason + " " + exchangeData.errorDetails);
        }
        // The JWT token seems to have a a validity of 1 hour. It doesn't seem to be a pure JWT token, some data seems to be appended
        return exchangeData.id_token;
    }

    public getApiBaseUrlForUser() {
        return this.electroluxRegionalBaseUrl;
    }

    /**
     * Load Gigya GMID data used in all communication with the gigya service.
     * @private
     */
    private async createGmidUcid() {
        await this.loadGigyaApiKey()

        if (this.gmidRefreshTime > Date.now()) {
            this.log("Gmid still valid")
            return
        }

        if (!this.gigyaApiKey || !this.gigyaDomain) {
            this.log("!!! A gigya api key and domain should be obtained before trying to create a GMID identifier")
            throw new AuthError("Incorrect auth flow");
        }

        let url = GIGYA_SOCIALIZE_GMID_URL.replace("GIGYA_DOMAIN", this.gigyaDomain);

        this.log("Loading gmid/ucid: " + url)
        const response = await fetch(url, {
            method: "POST",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Apikey': this.gigyaApiKey,
            },
            body: new URLSearchParams({
                "apiKey": this.gigyaApiKey,
                "format": "json",
                "httpStatusCodes": "false",
                "nonce": this.createNonce(),
                "sdk": "Android_7.0.11",
                "targetEnv": "mobile"
            })
        });

        const socializeIds = await response.json();
        this.gmid = socializeIds.gmid
        this.ucid = socializeIds.ucid
        this.gmidRefreshTime = socializeIds.refreshTime
    }

    /**
     * Get the API key used for gigya login communication from the Electrolux API
     * @private
     */
    private async loadGigyaApiKey() {
        if (this.gigyaApiKey) {
            this.log("Apikey already loaded")
            return
        }

        if (!this.countryCode) {
            this.log("!!! A user should login through the global API endpoint with a hardcoded api key first, so the country code can be obtained")
            this.log("!!! Otherwise the country code should be provided to the gigya authentication flow upon construction")
            throw new AuthError("Incorrect auth flow");
        }

        let url = ELECTROLUX_GIGYA_APIKEY_URL + this.countryCode;
        let accessToken = await this.getElectroluxAccessToken();
        let headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Bearer ' + accessToken,
            'X-Api-Key': ELECTROLUX_X_API_KEY,
        };
        this.log("Loading gigya API key: " + url )
        const response = await fetch(url, {
            method: "GET",
            headers: headers
        });

        let identityProviderData = await response.json();
        identityProviderData = identityProviderData[0]; // The server returns an array with one element
        this.electroluxRegionalBaseUrl = identityProviderData.httpRegionalBaseUrl
        this.gigyaApiKey = identityProviderData.apiKey
        this.gigyaDomain = identityProviderData.domain //e.g. eu1.gigya.com
        this.log("Gigya domain is " + this.gigyaDomain)
        this.log("Electrolux domain is " + this.electroluxRegionalBaseUrl)
    }

    /**
     * Get the OAuth token, required to get the Gigya API key (see loadApiKey() ), from the Electrolux API-
     * @private
     */
    private async getElectroluxAccessToken(): Promise<string> {
        if (this.electroluxAccessTokenRefreshTime) {
            this.log("Electrolux bearer token still valid already loaded")
            return this.electroluxAccessToken
        }

        let body = JSON.stringify({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            grantType: "client_credentials"
        });

        this.log("Obtaining electrolux access token for initial interaction with Gigya")
        const tokenExchangeResponse = await fetch(ELECTROLUX_TOKEN_URL, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': ELECTROLUX_X_API_KEY
            },
            body: body
        });
        const json = await tokenExchangeResponse.json();

        this.electroluxAccessToken = json.accessToken
        this.electroluxAccessTokenRefreshTime = Date.now() + (json.expiresIn * 1000)
        this.log("Obtained electrolux access token '" + this.electroluxAccessToken + "'for initial interaction with Gigya")
        return this.electroluxAccessToken;
    }

    public getSignedBodyString(method: string = "POST", url: string, params: any, secret: string) {
        delete params.sig // signature parameter should not be present as it is added after signing. If present, remove
        if (!params.timestamp)
            params.timestamp = Math.floor(Date.now() / 1000);
        if (!params.nonce)
            params.nonce = this.createNonce()

        // Get the parameter string with each parameter escaped, sorted alphabetically on parameter name
        const escapedParamString = this.getEncodedParameterString(params)
        console.log("params " + escapedParamString)
        const payload = method.toUpperCase() + "&" + encodeURIComponent(url) + "&" + encodeURIComponent(escapedParamString)
        console.log("Signing " + payload)
        const signatureValue = this.sign(payload, secret)
        console.log("signatureValue: ", signatureValue)
        return escapedParamString + "&sig=" + signatureValue
    }

    private createNonce() {
        return Date.now() + "_-" + randomInt(1000000000, 1099999999);
    }

    private sign(payload: string, key: string) {
        const keyBytes = this.base64ToArrayBuffer(key)
        let encoder = new TextEncoder();
        const payloadBytes = encoder.encode(payload);

        const hmac = crypto.createHmac('sha1', keyBytes);
        hmac.update(payloadBytes);

        let result = hmac.digest();
        result = this.arrayBufferToBase64(result)
        return result;
    }

    private base64ToArrayBuffer(base64: string) {
        var binaryString = atob(base64);
        var bytes = new Uint8Array(binaryString.length);
        for (var i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    private arrayBufferToBase64(buffer: ArrayBuffer) {
        var binary = '';
        var bytes = new Uint8Array(buffer);
        var len = bytes.byteLength;
        for (var i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        let result = btoa(binary);
        result = result.replace('\/', "_"); // Correct some characters to match the gigya java implementation
        result = result.replace('\+', "-"); // Correct some characters to match the gigya java implementation
        return result;
    }

    private getEncodedParameterString(params: any) {
        let result = ""
        console.log(Object.keys(params).sort())
        for (const key of Object.keys(params).sort()) {
            result += key + "=" + encodeURIComponent(params[key]) + "&";
        }
        return result.substring(0, result.length - 1)
    }
}