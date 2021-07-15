(async function () {
    let client = ZAFClient.init();
    const domain = await getSubdomain();
    const userId = await getCurrentUserId();
    await awaitUiLoaded();

    let serverAddress = 'cstat.nextel.com.ua';
    if (domain === 'd3v-nextel') {
        serverAddress = 'adept.pp.ua';
    } else if (domain === 'd3v-test1k') {
        serverAddress = 'meysons.pp.ua';
    }

    let wsUrl = `wss://${serverAddress}:8444/tracking/zendesk/${userId}/${domain}`;

    let ws;
    let closingCount = 0;
    let openedCallId = -1;
    let needToCloseWs = false;
    startWs();

    //<editor-fold desc="Websockets">
    function startWs() {
        ws = new WebSocket(wsUrl);
        ws.sendObject = function (obj) {
            this.send(JSON.stringify(obj))
        };
        ws.onopen = function () {
            console.debug("Соединение с Nextel установлено.");
        };
        ws.onmessage = function (event) {
            console.debug("Incoming message: ", event.data);
            onIncomingMessageFromSocket(JSON.parse(event.data));
        };
        ws.onclose = function () {
            closingCount++;
            if (closingCount > 9) {
                if (!widgetNotWorkingAlreadyShown) { //костыль
                    widgetNotWorkingAlreadyShown = true;
                    console.warn("Соединение с Nextel прервалось. 10 неудачных попыток подключения.");
                }
                return;
            }

            if (!needToCloseWs) {
                console.warn("Соединение с Nextel прервалось. Повторная попытка через 10 секунд..");
                const timeout = setTimeout(function () {
                    startWs()
                    clearTimeout(timeout);
                }, 10000);
            }
        };
    }

    function closeWs() {
        needToCloseWs = true;
        ws.close();
    }

    let error = null;
    let errorLink = null;
    let linkName = null;

    /**
     * Обработчик входящих сообщений. Сюда они попадают из сокета.
     */
    function onIncomingMessageFromSocket(incomingMessage) {
        const eventType = incomingMessage.eventType;
        if (incomingMessage.blocked) {
            error = 'Виджет Nextel не работает! Вероятно у Вас нестабильное интернет подключение';
            showError(error, null, null, true);
            closeWs();

        } else if (eventType === 'notFoundAcc') {
            error = 'Виджет Nextel не работает! Этот аккаунт не подключен';
            errorLink = 'https://my.nextel.com.ua/index.html#zendesk';
            linkName = 'Настроить Nextel';
            showError(error, errorLink, linkName, true);
            closeWs();

        } else if (eventType === 'noOperatorNumber') {
            error = 'Виджет Nextel не работает! Номер Вашей внутренней линии не указан';
            errorLink = 'https://my.nextel.com.ua/index.html#zendesk';
            linkName = 'Настроить Nextel';
            showError(error, errorLink, linkName, true);
            closeWs();

        } else if (eventType === 'operatorOnGsmWarn') {
            showError('Для совершения звонка необходимо указать внутреннюю линию',
                'https://my.nextel.com.ua/index.html#zendesk', 'Настроить Nextel', false);

        } else if (eventType === 'wrongToNumber') {
            showError('Звонок на номер ' + incomingMessage.to + ' нельзя осуществить', null, null, false);

        } else if (eventType === 'dialStart') {
            displayCall(incomingMessage.call, incomingMessage.contactId, incomingMessage.ticketId)

        } else if (eventType === 'dialEnd') {
            onDialEnd(incomingMessage.callId, false)

        } else if (eventType === 'answeredCall') {
            displayCall(incomingMessage.call, incomingMessage.contactId, incomingMessage.ticketId)
        }
    }

    //</editor-fold>

    client.on('voice.dialout', function (e) {
        ws.sendObject({
            eventType: 'callTo',
            to: e.number
        })
    });

    const $dialer = $('.nextel_notif-dialer');
    const $dialButton = $dialer.find('.nextel_dial-button');
    const $phoneNumberInput = $dialer.find('.nextel_notif-dialer-number-input');

    $dialButton.click(() => {
        const phoneNumber = $phoneNumberInput.val().trim();
        ws.sendObject({eventType: 'callTo', to: phoneNumber});
    });

    const $callInfo = $('.nextel_notif-call-info');
    const $errorInfo = $('.nextel_notif-error-info');
    const $errorDescription = $errorInfo.find('.nextel_notif-error-description');
    const $errorLink = $errorInfo.find('.nextel_notif-error-link');
    const $errorOkButton = $errorInfo.find('.nextel_notif-error-ok-button');

    $errorOkButton.click(showDialer);

    showDialer();

    //<editor-fold desc="Переключение режимов звонилка/ошибка/инфо">
    function showDialer() {
        $dialer.show();
        $callInfo.hide();
        $errorInfo.hide();
        client.invoke('resize', {height: 360, width: 250});
    }

    function showCallInfo(height, width) {
        $dialer.hide();
        $errorInfo.hide();
        $callInfo.show();
        if (!width) {
            width = 350;
        }
        client.invoke('resize', {height: height, width: width});
        showWidget();
    }

    function showError(description, link, linkName, dontShowButton) {
        $dialer.hide();
        $callInfo.hide();
        $errorInfo.show();
        $errorDescription.text(description);
        if (link) {
            $errorLink.attr('href', link).show();
            if (linkName) {
                $errorLink.text(linkName);
            }
        } else {
            $errorLink.hide();
        }
        if (dontShowButton) {
            $errorOkButton.hide();
        }
        client.invoke('resize', {height: 250, width: 270});
        showWidget()
    }

    //</editor-fold>

    function showWidget() {
        client.invoke('popover', 'show');
    }

    function hideWidget() {
        client.invoke('popover', 'hide')
    }

    client.on('pane.activated', function (e) {
        if (error) {
            showError(error, errorLink)
        }
    });

    //<editor-fold desc="onDialEnd">
    async function onDialEnd(callId, answeredUser) {
        if (openedCallId === callId) {
            if (answeredUser) {
                setTimeout(() => {
                    hide()
                }, 5000);
            } else {
                hide()
            }
        }

        function hide() {
            if (openedCallId === callId) {
                hideWidget();
                setTimeout(showDialer, 500);
            }
        }
    }

    //</editor-fold>

    //<editor-fold desc="displayCall">
    async function displayCall(call, contactIdFromBackend, ticketIdFromBackend) {
        const direction = call.direction;
        openedCallId = call.rid;

        const $headerDescription = $callInfo.find('.nextel_notif-call-info-header-description');
        const $inCallIcon = $callInfo.find('.nextel_notif-in-call-icon');
        const $outCallIcon = $callInfo.find('.nextel_notif-out-call-icon');

        //<editor-fold desc="хедер уведомления">
        if (direction === 'INNER') {
            return;
        } else if (direction === 'OUT') {
            $inCallIcon.hide();
            $outCallIcon.show();
        } else {
            $inCallIcon.show();
            $outCallIcon.hide();
        }

        const type = call.type;
        let typeDescription = '';
        if (type.indexOf('C2C_') === 0) {
            typeDescription = 'Входящий click to call звонок';

        } else if (type === 'TRACKING') {
            typeDescription = 'Входящий call tracking звонок';

        } else if (type === 'REGULAR') {
            if (direction === 'OUT') {
                typeDescription = 'Исходящий звонок';
            } else {
                typeDescription = 'Прямой входящий звонок';
            }

        } else if (type === 'AUTO_CB') {
            typeDescription = 'Автоперезвон';

        } else if (type === 'CALLBACK') {
            typeDescription = 'Callback звонок';

        } else if (type === 'AUTODIAL') {
            typeDescription = 'Автообзвон';

        } else if (type === 'API') {
            typeDescription = 'API звонок';
        }
        $headerDescription.text(typeDescription);
        //</editor-fold>

        //<editor-fold desc="Блок юзера">
        const $userDetails = $callInfo.find('.nextel_notif-user-info');
        const $ticketDetails = $callInfo.find('.nextel_notif-ticket-details');
        let clientNumber = call.direction === 'IN' ? call.calledFrom : call.calledTo[0];
        const user = contactIdFromBackend
            ? await getUserById(contactIdFromBackend)
            : await getUserByPhoneNumber(clientNumber);
        // : null;

        const $contactName = $userDetails.find('.nextel_notif-contact-name').removeClass('withLink');
        const $contactNotes = $userDetails.find('.nextel_notif-contact-notes-div');
        const $userAvatar = $userDetails.find('.nextel_notif-user-avatar');

        let windowHeight = 165;
        let windowWidth = 350;

        if (!user) {
            $ticketDetails.hide();
            $contactNotes.hide();
            $contactName.text(clientNumber);
            $userAvatar.attr('src', 'user-avatar.png');

        } else {
            $ticketDetails.show();
            $contactNotes.show();

            if (user.photo) {
                $userAvatar.attr('src', user.photo.content_url)
            } else {
                $userAvatar.attr('src', 'user-avatar.png');
            }

            $contactName.text(user.name)
                .addClass('withLink')
                .click(() => {client.invoke('routeTo', 'user', user.id)});

            if (user.notes) {
                $contactNotes.text(user.notes);
            }
        }
        //</editor-fold>

        //<editor-fold desc="Блок тикета">
        if (user) {
            const ticket = ticketIdFromBackend
                ? await getTicketById(ticketIdFromBackend)
                : await getTicketByUserId(user.id);

            if (!ticket) {
                $ticketDetails.hide();
            } else {
                $ticketDetails.show();

                const $ticketName = $ticketDetails.find('.nextel_notif-ticket-name');
                $ticketName.text(ticket.subject);
                $ticketName.click(() => {client.invoke('routeTo', 'ticket', ticket.id)});
                const $assignee = $ticketDetails.find('.nextel_notif-assignee');
                if (ticket.assignee_id != null) {
                    const assainee = await getUserById(ticket.assignee_id);
                    $assignee.text(assainee.name)
                } else {
                    const groupName = await getGroupNameById(ticket.group_id);
                    $assignee.text(groupName)
                }
                const $ticketDescription = $ticketDetails.find('.nextel_notif-ticket-description');
                let description = ticket.description;
                if (description.length > 180) {
                    description = description.substring(0, 180) + '...'
                }
                $ticketDescription.text(description);
                windowHeight += 135;
            }
        }
        //</editor-fold>

        //<editor-fold desc="Блок аналитики">
        const $analyticsDetails = $callInfo.find('.nextel_notif-analytics-details');
        let outerNumber = call.outerNumber;
        if (outerNumber && !outerNumber.replace(/[0-9]/g, '').trim()) {
            outerNumber = null;
        }
        if (!outerNumber && !call.utmSource && !call.utmMedium && !call.utmCampaign
            && !call.utmTerm && !call.utmContent && !call.googleId && !call.referer && !call.ip) {
            $analyticsDetails.hide();
        } else {
            $analyticsDetails.show();

            windowHeight += 40;
            windowWidth = 450;

            showAnalyticOrHide('.nextel_notif-analytics-outerPhone', outerNumber);
            showAnalyticOrHide('.nextel_notif-analytics-source', call.utmSource);
            showAnalyticOrHide('.nextel_notif-analytics-medium', call.utmMedium);
            showAnalyticOrHide('.nextel_notif-analytics-campaign', call.utmCampaign);
            showAnalyticOrHide('.nextel_notif-analytics-term', call.utmTerm);
            showAnalyticOrHide('.nextel_notif-analytics-content', call.utmContent);
            showAnalyticOrHide('.nextel_notif-analytics-referer', call.referer);
            showAnalyticOrHide('.nextel_notif-analytics-ip', call.ip);
            showAnalyticOrHide('.nextel_notif-analytics-gid', call.googleId);

            function showAnalyticOrHide(clazz, analyticsData) {
                const $field = $analyticsDetails.find(clazz);
                if (analyticsData) {
                    $field.text(analyticsData).parent().show();
                    windowHeight += 13;
                } else {
                    $field.parent().hide();
                }
            }
        }
        showCallInfo(windowHeight, windowWidth);
        //</editor-fold>


        if (call.callPhase === 'ANSWERED') {
            setTimeout(() => {
                if (openedCallId === call.rid) {
                    hideWidget();
                    setTimeout(showDialer, 500);
                }
            }, 5000);
        }
    }

    //</editor-fold>

    //<editor-fold desc="getGroupNameById">
    async function getGroupNameById(groupId) {
        const response = await getApi({
            url: '/api/v2/groups/' + groupId + '.json',
            type: 'GET',
            dataType: 'json'
        });
        return response.group.name;
    }

    //</editor-fold>

    //<editor-fold desc="getUserById">
    async function getUserById(userId) {
        const response = await getApi({
            url: '/api/v2/users/' + userId + '.json',
            type: 'GET',
            dataType: 'json'
        });
        return response.user;
    }

    //</editor-fold>

    //<editor-fold desc="getUserByPhoneNumber">
    async function getUserByPhoneNumber(phone) {
        if (phone.indexOf('380') === 0) {
            phone = phone.substring(2);
        }

        const response = await getApi({
            url: '/api/v2/users.json?query=phone:*' + phone,
            type: 'GET',
            dataType: 'json'
        });
        const users = response.users;
        users.sort((u1, u2) => {
            return Date.parse(u1.created_at) - Date.parse(u2.created_at);
        });

        return users.length === 0 ? null : users[0];
    }

    //</editor-fold>

    //<editor-fold desc="getTicketByUserId">
    async function getTicketByUserId(userId) {
        const response = await getApi({
            url: '/api/v2/search.json?query=requester:' + userId,
            type: 'GET',
            dataType: 'json'
        });
        const results = response.results;
        if (results.length === 0) {
            return null;
        }
        if (results.length === 1) {
            return results[0];
        }

        const openTickets = [];
        for (let i = 0; i < results.length; i++) {
            const ticket = results[i];
            if (ticket.status !== 'solved' && ticket.status !== 'closed') {
                openTickets.push(ticket);
            }
        }

        openTickets.sort((t1, t2) => {
            return Date.parse(t2.created_at) - Date.parse(t1.created_at);
        });

        return openTickets.length === 0 ? null : openTickets[0];
    }

    //</editor-fold>

    //<editor-fold desc="getTicketById">
    async function getTicketById(id) {
        const response = await getApi({
            url: '/api/v2/tickets/' + id + '.json',
            type: 'GET',
            dataType: 'json'
        });
        return response.ticket;
    }

    //</editor-fold>

    //<editor-fold desc="getApi">
    async function getApi(options) {
        return new Promise(function (resolve) {
            client.request(options)
                .then((results) => {
                    resolve(results)
                })
                .catch((error) => {
                    console.debug("Error:", error);
                });
        })
    }

    //</editor-fold>

    //<editor-fold desc="getSubdomain">
    async function getSubdomain() {
        return new Promise(function (resolve) {
            client.context().then((context) => {resolve(context.account.subdomain)});
        })
    }

    //</editor-fold>

    //<editor-fold desc="getCurrentUserId">
    async function getCurrentUserId() {
        return new Promise(function (resolve) {
            client.get('currentUser').then((data) => {resolve(data.currentUser.id)});
        })
    }

    //</editor-fold>

    //<editor-fold desc="awaitUiLoaded">
    async function awaitUiLoaded() {
        return new Promise(function (resolve) {
            let interval = setInterval(() => {
                if ($('.nextel_notif-dialer').length > 0) {
                    clearInterval(interval);
                    resolve();
                }
            }, 400);
        })
    }

    //</editor-fold>

    const $phoneNumberInputField = $('.nextel_notif-dialer-number-input');

    $('.nextel_dialer-table td').click((element) => {
        const text = element.target.innerHTML;
        $phoneNumberInputField.val($phoneNumberInputField.val() + text)
    })


})();