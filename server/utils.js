'use strict';

const dictionary = require("./dictionary.js");
const g_constants = require("./constants.js");
const g_crypto = require('crypto');
const http = require('http');
const https = require('https');
const url = require('url');

exports.Hash = function(str)
{
    return g_crypto.createHash("sha256").update(str).digest('base64');
};
exports.HashPassword = function(strPassword)
{
    return exports.Hash(strPassword + g_constants.password_private_suffix);
};

exports.UpdateSession = function(userid, token, callback)
{
    if (!userid) 
    {
        g_constants.dbTables['sessions'].delete("token='"+escape(token)+"'");
        callback();
        return;
    }
        
    g_constants.dbTables['sessions'].insert(token, Date.now(), userid, err => {
        if (!err) 
        {
            g_constants.dbTables['sessions'].delete('time < '+Date.now()+' - '+g_constants.SESSION_TIME);
            callback();
            return;
        }
        g_constants.dbTables['sessions'].update("time='"+Date.now()+"'", "token='"+escape(token)+"'", err => { 
            callback(); 
        });
    });
}

exports.CheckUserExist = function(user, email, callback)
{
    IsUserExist(user, function(exist) {
        if (exist.result == true)
        {
            callback({result: true, message: 'Sorry. This user already registered', info: exist.row});
            return;
        }
                
        IsEmailExist(email, function(exist){
            if (exist.result == true)
            {
                callback({result: true, message: 'Sorry. This email already registered', info: exist.row});
                return;
            }
            callback({result: false, message: ''});
        });
    });

    function IsUserExist(user, callback)
    {
        if (!user.length)
        {
            callback({result: false});
            return;
        }
        
        g_constants.dbTables['users'].selectAll("ROWID AS id, *", "login='"+escape(user)+"'", "", function(error, rows) {
            if (rows && rows.length)
            {
                callback({result: true, row: rows[0]});
                return;
            }
            callback({result: false});
        });
    }
    
    function IsEmailExist(email, callback)
    {
        if (!email.length)
        {
            callback({result: false});
            return;
        }

        g_constants.dbTables['users'].selectAll("ROWID AS id, *", "email='"+escape(email)+"'", "", function(error, rows) {
            if (rows && rows.length)
            {
                callback({result: true, row: rows[0]});
                return;
            }
            callback({result: false});
        });
    }
}

exports.ForEachSync = function(array, func, cbEndAll, cbEndOne)
{
    if (!array || !array.length)
    {
        console.log('success: ForEachAsync (!array || !array.length)');
        cbEndAll(false);
        return;
    }
    
    Run(0);
    
    function Run(nIndex)
    {
        if (nIndex >= array.length) throw 'error: ForEachSync_Run (nIndex >= array.length)';
        func(array, nIndex, onEndOne);
        
        function onEndOne(err, params)
        {
            if (!cbEndOne)
            {
                if (nIndex+1 < array.length && err == false)
                    Run(nIndex+1);
                else
                    cbEndAll(false); //if all processed then stop and return from 'ForEachSync'
                return;
            }
            
            if (!params) params = {};
            
            params.nIndex = nIndex;
            
            cbEndOne(err, params, function(error) {
                if (error) {
                    //if func return error, then stop and return from 'ForEachSync'
                    console.log('error: ForEachSync_Run_cbEndOne return error');
                    cbEndAll(true);
                    return;
                }
                if (nIndex+1 < array.length)
                    Run(nIndex+1);
                else
                    cbEndAll(false); //if all processed then stop and return from 'ForEachSync'
            });
        }
    }
};

exports.GetSessionStatus = function(req, callback)
{
    req['token'] = exports.parseCookies(req)['token'] || '';
    if (!req.token || !req.token.length)
    {
        callback({active: 'false'});
        return;
    }
    
    g_constants.dbTables['sessions'].selectAll('*', 'token="'+escape(req.token)+'"', '', (err, rows) => {
        if (err || !rows || !rows.length)
        {
            callback({active: 'false'});
            return;
        }
        if (Date.now() - rows[0].time > g_constants.SESSION_TIME)
        {
            g_constants.dbTables['sessions'].delete('time < '+Date.now()+' - '+g_constants.SESSION_TIME);
            callback({active: 'false'});
            return;
        }
        
        const session = rows[0];
        exports.UpdateSession(rows[0].userid, rows[0].token, () => {
            g_constants.dbTables['users'].selectAll("ROWID AS id, *", "ROWID='"+rows[0].userid+"'", "", (error, rows) => {
                if (err || !rows || !rows.length)
                {
                    callback({active: 'false'});
                    return;
                }
                callback({active: 'true', token: session.token, user: rows[0].login, email: rows[0].email, id: rows[0].id, info: rows[0].info});
            });
        });
    });
}

exports.parseCookies = function(request) {
    if (!request || !request.headers)
        return {};
        
    var list = {},
        rc = request.headers.cookie;

    rc && rc.split(';').forEach(function( cookie ) {
        var parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    return list;
};

exports.render = function(responce, page, info)
{
    const lang = (info && info.lang ? info.lang : 'en');

    let render_info = info || {};
    
    render_info['dict'] = dictionary.object;
    render_info['dict']['server_time'] = Date.now();
    render_info['dict'].setLanguage(lang);
    
    render_info['__'] = render_info['dict'].l;
    
    render_info['recaptcha'] = g_constants.recaptcha_pub_key;
    render_info['debug'] = g_constants.DEBUG_MODE;

    responce.render(page, render_info);
}

exports.getJSON = function(query, callback)
{
    const parsed = url.parse(query, true);
    const options = {
        host: parsed.host,
        port: parsed.port || parsed.protocol=='https:' ? 443 : 80,
        path: parsed.path,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    exports.getHTTP(options, callback);
};
exports.postJSON = function(query, body, callback)
{
    const parsed = url.parse(query, true);
    const options = {
        host: parsed.host,
        port: parsed.port || parsed.protocol=='https:' ? 443 : 80,
        path: parsed.path,
        method: 'POST',
        body: body,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    exports.getHTTP(options, callback);
};

exports.postHTTP = function(query, headers, callback)
{
    const parsed = url.parse(query, true);
    const options = {
        host: parsed.host,
        port: parsed.port || parsed.protocol=='https:' ? 443 : 80,
        path: parsed.path,
        method: 'POST',
        headers: headers
    };
    exports.getHTTP(options, callback);
}

exports.getHTTP = function(options, onResult)
{
    console.log("rest::getJSON");

    const port = options.port || 80;
    const prot = port == 443 ? https : http;
    
    if (!options.method)
        options.method = 'GET';
    if (!options.headers)
        options.headers = {'Content-Type': 'application/json'};
        
    var req = prot.request(options, function(res)
    {
        var output = '';
        console.log(options.host + ':' + res.statusCode);
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            output += chunk;
        });

        res.on('end', function() {
            if (options.headers['Content-Type'] == 'application/json')
            {
                try {
                    var obj = JSON.parse(output);
                    onResult(res.statusCode, obj);

                }catch(e) {
                    console.log(e.message);
                    onResult(res.statusCode, e);
                }
                
                return;
            }
            onResult(res.statusCode, output);
        });
    });

    req.on('error', function(err) {
        console.log(err.message)
        onResult('0', 'unknown error');
    });

    req.end();
};

exports.renderJSON = function(req, res, params)
{
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify(params));
};

exports.ValidateEmail = function(text)
{
    if (!text || !text.length)
        return false;
            
    const mailformat = /^[-a-z0-9!#$%&'*+/=?^_`{|}~]+(?:\.[-a-z0-9!#$%&'*+/=?^_`{|}~]+)*@(?:[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\.)*(?:aero|arpa|asia|biz|cat|com|coop|edu|gov|info|int|jobs|mil|mobi|museum|name|net|org|pro|tel|travel|[a-z][a-z])$/;
    return text.match(mailformat);
}

exports.validateRecaptcha = function(request, callback)
{
    if (!request.body || !request.body['g-recaptcha-response'])
    {
        callback({error: true, message: 'Bad Request'});
        return;
    }
    
    exports.postHTTP(
        "https://www.google.com/recaptcha/api/siteverify?secret="+g_constants.recaptcha_priv_key+"&response="+request.body['g-recaptcha-response'], 
        {}, 
        (code, data) => {
            var ret = data ? JSON.parse(data) : {};
            if (!data)
                ret['success'] = false;
                
            ret['error'] = !ret.success;
            ret.message = ret.error ? 'Recaptcha failed' : '';
            
            callback(ret);
        }
    );
}