/// <reference path='./context.d.ts' />
/// <reference path='../../../third_party/polymer/polymer.d.ts' />
/// <reference path='../../../third_party/typings/index.d.ts' />

import ui_constants = require('../../interfaces/ui');
import social = require('../../interfaces/social');
import uproxy_core_api = require('../../interfaces/uproxy_core_api');
import _ = require('lodash');
import translator = require('../scripts/translator');
import user = require('../scripts/user');
import dialogs = require('../scripts/dialogs');

const DEFAULT_PROVIDER = 'digitalocean';

Polymer({
  created: function() {
    this.offeringInstancesChanged = _.throttle(this.offeringInstancesChanged.bind(this), 100);
  },
  contact: {
    // Must adhere to the typescript interface UI.User.
    name: 'unknown'
  },
  toggle: function() {
    if (this.contact.status == this.UserStatus.REMOTE_INVITED_BY_LOCAL) {
      return;
    }

    if (!this.isExpanded) {
      // Hide the status before we start opening the core-collapse.
      this.hideOnlineStatus = true;
    } else {
      // Let core-collapse close before reshowing the online status.
      setTimeout(() => { this.hideOnlineStatus = false; }, 400);
    }

    if (this.isSharer) {
      this.contact.shareExpanded = !this.contact.shareExpanded;
    } else if (this.isGetter) {
      this.contact.getExpanded = !this.contact.getExpanded;
    }
  },
  openLink: function(event :Event) {
    this.ui.browserApi.openTab(this.contact.url);
    event.stopPropagation();  // Don't toggle when link is clicked.
  },
  acceptInvitation: function() {
    var socialNetworkInfo :social.SocialNetworkInfo = {
      name: this.contact.network.name,
      userId: this.contact.network.userId
    };
    ui_context.core.acceptInvitation({
      network: socialNetworkInfo, userId: this.contact.userId
    });
  },
  // |action| is the string end for a uproxy_core_api.ConsentUserAction
  modifyConsent: function(action :uproxy_core_api.ConsentUserAction) {
    var command = <uproxy_core_api.ConsentCommand>{
      path: {
        network : {
         name: this.contact.network.name,
         userId: this.contact.network.userId
        },
        userId: this.contact.userId
      },
      action: action
    };
    console.log('[polymer] consent command', command)
    ui_context.core.modifyConsent(command);
  },

  // Proxy UserActions.
  request: function() { this.modifyConsent(uproxy_core_api.ConsentUserAction.REQUEST) },
  cancelRequest: function() {
    this.modifyConsent(uproxy_core_api.ConsentUserAction.CANCEL_REQUEST)
  },
  ignoreOffer: function() { this.modifyConsent(uproxy_core_api.ConsentUserAction.IGNORE_OFFER) },
  unignoreOffer: function() { this.modifyConsent(uproxy_core_api.ConsentUserAction.UNIGNORE_OFFER) },

  // Client UserActions
  offer: function() { this.modifyConsent(uproxy_core_api.ConsentUserAction.OFFER) },
  cancelOffer: function() {
    this.ui.stopGivingInUi();
    this.modifyConsent(uproxy_core_api.ConsentUserAction.CANCEL_OFFER);
  },
  ignoreRequest: function() { this.modifyConsent(uproxy_core_api.ConsentUserAction.IGNORE_REQUEST) },
  unignoreRequest: function() { this.modifyConsent(uproxy_core_api.ConsentUserAction.UNIGNORE_REQUEST) },
  hasInstance: function(instanceId :string) {
    // TODO: upgrade to lodash 4.x
    return instanceId && (<any>_).contains(this.contact.allInstanceIds, instanceId);
  },
  fireChanged: function() {
    // this is needed as a slight hack since the observer on the contacts array
    // a level up does not pick up on changes in contact properties
    this.fire('contact-changed');
  },
  getExpandedChanged: function(oldIsExpanded :boolean, newIsExpanded :boolean) {
    if (newIsExpanded && this.mode == ui_constants.Mode.GET) {
      this.hideOnlineStatus = true;
    }
  },
  shareExpandedChanged: function(oldIsExpanded :boolean, newIsExpanded :boolean) {
    if (newIsExpanded && this.mode == ui_constants.Mode.SHARE) {
      this.hideOnlineStatus = true;
    }
  },
  offeringInstancesChanged: function() {
    // instanceId arbitrarily chosen
    // TODO: upgrade to lodash 4.x
    this.sortedInstances = (<any>_).sortByOrder(this.contact.offeringInstances,
                                         ['isOnline', 'instanceId'], ['desc', 'asc']);
  },
  shareCloudFriend: function() {
    ui_context.core.getInviteUrl({
      network: {
        name: this.contact.network.name,
        userId: this.contact.network.userId // Local userId
      },
      // isOffering is false because we are not offering access to proxy
      // through this local instance of uProxy, rather we are sharing access
      // to a cloud server which we own.  All permissioning is done at the
      // cloud social provider layer, not in uProxy.
      isOffering: false,
      isRequesting: false,
      userId: this.contact.userId // Cloud instance userId
    }).then((cloudInviteUrl: string) => {
      this.$.state.openDialog(dialogs.getMessageDialogDescription(
          translator.i18n_t('CLOUD_SHARE_INSTRUCTIONS'), '', null, cloudInviteUrl));
    });
  },
  removeCloudFriend: function(event: Event) {
    this.displayCloudRemovalConfirmation().then(() => {
      // Destroy cloud server if created by user
      return this.destroyCloudServerIfNeeded();
    }).then(() => {
      // Remove contact from friend list
      return ui_context.core.removeContact({
        networkName: this.contact.network.name,
        userId: this.contact.userId
      });
    }).then(() => {
      this.fire('core-signal', {
        name: 'show-toast',
        data: {
          toastMessage: translator.i18n_t('REMOVE_CLOUD_SERVER_SUCCESS')
        }
      });
    }).catch((e: Error) => {
      if (!e) {
        return;
      }

      if (e.name === 'CLOUD_ERR') {
        this.$.state.openDialog(dialogs.getMessageDialogDescription(
            translator.i18n_t('REMOVE_CLOUD_SERVER'),
            translator.i18n_t('DESTROY_CLOUD_SERVER_FAILURE')));
      } else {
        this.$.state.openDialog(dialogs.getMessageDialogDescription(
            translator.i18n_t('REMOVE_CLOUD_SERVER'),
            translator.i18n_t('REMOVE_CLOUD_SERVER_FAILURE')));
      }
    });

    event.stopPropagation();
  },
  displayCloudRemovalConfirmation: function() {
    if (this.contact.status === this.UserStatus.CLOUD_INSTANCE_CREATED_BY_LOCAL) {
      return this.$.state.openDialog(dialogs.getConfirmationDialogDescription(
        translator.i18n_t('REMOVE_CLOUD_SERVER'),
        translator.i18n_t('DESTROY_CLOUD_SERVER_CONFIRMATION'),
        translator.i18n_t('CANCEL'),
        translator.i18n_t('CONTINUE')));
    } else {
      return this.$.state.openDialog(dialogs.getConfirmationDialogDescription(
        translator.i18n_t('REMOVE_CLOUD_SERVER'),
        translator.i18n_t('REMOVE_CLOUD_SERVER_CONFIRMATION'),
        translator.i18n_t('CANCEL'),
        translator.i18n_t('CONTINUE')));
    }
  },
  destroyCloudServerIfNeeded: function() {
    if (this.contact.status === this.UserStatus.CLOUD_INSTANCE_CREATED_BY_LOCAL) {
      this.fire('core-signal', {
        name: 'show-toast',
        data: {
          toastMessage: translator.i18n_t('REMOVING_UPROXY_CLOUD_STATUS')
        }
      });
      return ui_context.core.cloudUpdate({
        operation: uproxy_core_api.CloudOperationType.CLOUD_DESTROY,
        providerName: DEFAULT_PROVIDER
      }).catch((e: Error) => {
        return Promise.reject({
          'name':'CLOUD_ERR',
          'message':'Could not destroy cloud server.'
        });
      });
    }
    return Promise.resolve<void>();
  },
  ready: function() {
    this.ui = ui_context.ui;
    this.ui_constants = ui_constants;
    this.model = ui_context.model;
    this.GettingConsentState = user.GettingConsentState;
    this.SharingConsentState = user.SharingConsentState;
    this.hideOnlineStatus = this.isExpanded;
    this.UserStatus = social.UserStatus;
  },
  observe: {
    'contact.isSharingWithMe': 'fireChanged',
    'contact.isGettingFromMe': 'fireChanged',
    'contact.isOnline': 'fireChanged',
    /* handle expand/collapse changes from ui.ts, toggle() handles other cases */
    'contact.getExpanded': 'getExpandedChanged',
    'contact.shareExpanded': 'shareExpandedChanged',
    'contact.offeringInstances': 'offeringInstancesChanged',
  },
  computed: {
    'isGetter': 'mode === ui_constants.Mode.GET',
    'isSharer': 'mode === ui_constants.Mode.SHARE',
    'isExpanded': '(isGetter && contact.getExpanded) || (isSharer && contact.shareExpanded)',
  }
});
