const React = require('react');
const PropTypes = require('prop-types');
const bindAll = require('lodash.bindall');
const classNames = require('classnames');
const keyMirror = require('keymirror');
const FormattedMessage = require('react-intl').FormattedMessage;

const Formsy = require('formsy-react').default;
const FlexRow = require('../../../components/flex-row/flex-row.jsx');
const Avatar = require('../../../components/avatar/avatar.jsx');
const InplaceInput = require('../../../components/forms/inplace-input.jsx');
const Button = require('../../../components/forms/button.jsx');
const CommentingStatus = require('../../../components/commenting-status/commenting-status.jsx');
const MuteModal = require('../../../components/modal/mute/modal.jsx');
const formatTime = require('../../../lib/format-time');

const connect = require('react-redux').connect;

const api = require('../../../lib/api');

require('./comment.scss');

const onUpdate = update => update;

const MAX_COMMENT_LENGTH = 500;

const ComposeStatus = keyMirror({
    EDITING: null,
    SUBMITTING: null,
    REJECTED: null,
    REJECTED_MUTE: null
});

class ComposeComment extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handlePost',
            'handleCancel',
            'handleInput',
            'handleMuteClose',
            'handleMuteOpen',
            'isMuted',
            'setupMuteExpirationTimeout'
        ]);
        const muteExpiresAtMs = this.props.muteStatus.muteExpiresAt * 1000; // convert to ms
        this.state = {
            message: '',
            status: ComposeStatus.EDITING,
            error: null,
            appealId: null,
            muteOpen: false,
            muteExpiresAtMs: muteExpiresAtMs
        };
        if (this.isMuted()) {
            this.setupMuteExpirationTimeout(muteExpiresAtMs);
        }
    }
    setupMuteExpirationTimeout (muteExpiresAtMs) {
        // Change state when the mute expiration fires if the user is still on the page.
        setTimeout(() => {
            this.setState(
                {message: '', muteExpiresAtMs: 0, muteOpen: false, status: ComposeStatus.EDITING, error: null});
        }, muteExpiresAtMs - Date.now());
    }
    handleInput (event) {
        this.setState({
            message: event.target.value,
            status: ComposeStatus.EDITING,
            error: null,
            appealId: null
        });
    }
    handlePost () {
        this.setState({status: ComposeStatus.SUBMITTING});
        api({
            uri: `/proxy/comments/project/${this.props.projectId}`,
            authentication: this.props.user.token,
            withCredentials: true,
            method: 'POST',
            useCsrf: true,
            json: {
                content: this.state.message,
                parent_id: this.props.parentId || '',
                commentee_id: this.props.commenteeId || ''
            }
        }, (err, body, res) => {
            if (err || res.statusCode !== 200) {
                body = {rejected: 'error'};
            }
            if (body.rejected && this.state.status === ComposeStatus.SUBMITTING) {
                let muteOpen = false;
                let muteExpiresAtMs = 0;
                let rejectedStatus = ComposeStatus.REJECTED;
                if (body.status && body.status.mute_status) {
                    muteExpiresAtMs = body.status.mute_status.muteExpiresAt * 1000; // convert to ms
                    rejectedStatus = ComposeStatus.REJECTED_MUTE;
                    if (this.shouldShowMuteModal(body.status.mute_status.offenses)) {
                        muteOpen = true;
                    }
                    this.setupMuteExpirationTimeout(muteExpiresAtMs);
                }
                // Note: does not reset the message state
                this.setState({
                    status: rejectedStatus,
                    error: body.rejected,
                    appealId: body.appealId,
                    muteOpen: muteOpen,
                    muteExpiresAtMs: muteExpiresAtMs
                });
                return;
            }

            // Clear the text field and reset status on successful submission
            this.setState({
                message: '',
                status: ComposeStatus.EDITING,
                error: null,
                appealId: null
            });

            // Add the username, which isn't included right now from scratch-api
            if (body.author) body.author.username = this.props.user.username;

            this.props.onAddComment(body);
        });
    }

    convertToMinutesFromNow (timeStampInSec) {
        return Math.ceil(((timeStampInSec * 1000) - Date.now()) / (60 * 1000));
    }

    isMuted () {
        return this.state.muteExpiresAtMs > Date.now();
    }

    handleMuteClose () {
        this.setState({
            muteOpen: false
        });
    }

    handleMuteOpen () {
        this.setState({
            muteOpen: true
        });
    }
    shouldShowMuteModal (offensesList) {
        // We should show the mute modal whne the user is newly muted or hasn't seen it for a while.
        // We don't want to show it more than about once a week.
        // A newly muted user has only 1 offense and it happened in the last coulpe of minutes.
        // If a user has more than 1 offense, it means that they have have been muted in the
        // last week.
        // Assumption: The offenses list is ordered by time with the most recent at the end.

        // This check is here just in case we somehow get bad data back from a backend.
        if (!offensesList) {
            return false;
        }

        const numOffenses = offensesList.length;
        // This isn't intended to be called if there are no offenses, but
        // say no just in case.
        if (numOffenses === 0) {
            return false;
        }

        const mostRecent = offensesList[numOffenses - 1];
        const creationTimeMinutesAgo = this.convertToMinutesFromNow(mostRecent.createdAt);
        return creationTimeMinutesAgo < 2 && numOffenses === 1;
    }

    getMuteMessageInfo () {
        // return the ids for the messages that are shown for this mute type
        // Note, it will probably be passed a 'type', but right now there's only one
        // If mute modals have more than one unique "step" we could pass an array of steps
        return {
            commentType: 'comment.type.disrespectful',
            muteStepHeader: 'comment.disrespectful.header',
            muteStepContent: ['comment.disrespectful.content1', 'comment.disrespectful.content2']
        };
    }

    handleCancel () {
        this.setState({
            message: '',
            status: ComposeStatus.EDITING,
            error: null,
            appealId: null
        });
        if (this.props.onCancel) this.props.onCancel();
    }
    render () {
        return (
            <React.Fragment>
                {this.isMuted() ? (
                    <FlexRow className="comment">
                        <CommentingStatus>
                            <p><FormattedMessage id={this.getMuteMessageInfo().commentType} /></p>
                            <p>
                                <FormattedMessage
                                    id="comments.muted.duration"
                                    values={{
                                        inDuration:
                                        formatTime.formatRelativeTime(this.state.muteExpiresAtMs, window._locale)
                                    }}
                                /> <FormattedMessage id="comments.muted.commentingPaused" />
                            </p>
                            <p className="bottom-text">
                                <FormattedMessage
                                    id="comments.muted.moreInfoModal"
                                    values={{clickHereLink: (
                                        <a
                                            href="#comment"
                                            onClick={this.handleMuteOpen}
                                        >
                                            <FormattedMessage id="comments.muted.clickHereLinkText" />
                                        </a>
                                    )}}
                                />
                            </p>
                        </CommentingStatus>
                    </FlexRow>
                ) : null }
                {!this.isMuted() || (this.isMuted() && this.state.status === ComposeStatus.REJECTED_MUTE) ? (
                    <div
                        className={classNames('flex-row',
                            'comment',
                            this.state.status === ComposeStatus.REJECTED_MUTE ?
                                'compose-disabled' : '')}
                    >
                        <a href={`/users/${this.props.user.username}`}>
                            <Avatar src={this.props.user.thumbnailUrl} />
                        </a>
                        <FlexRow className="compose-comment column">
                            {this.state.error && this.state.status !== ComposeStatus.REJECTED_MUTE ? (
                                <FlexRow className="compose-error-row">
                                    <div className="compose-error-tip">
                                        <FormattedMessage
                                            id={`comments.${this.state.error}`}
                                            values={{
                                                appealId: this.state.appealId
                                            }}
                                        />
                                    </div>
                                </FlexRow>
                            ) : null}
                            <Formsy className="full-width-form">
                                <InplaceInput
                                    className={classNames('compose-input',
                                        MAX_COMMENT_LENGTH - this.state.message.length >= 0 ?
                                            'compose-valid' : 'compose-invalid')}
                                    disabled={this.state.status === ComposeStatus.REJECTED_MUTE}
                                    handleUpdate={onUpdate}
                                    name="compose-comment"
                                    type="textarea"
                                    value={this.state.message}
                                    onInput={this.handleInput}
                                />
                                <FlexRow className="compose-bottom-row">
                                    <Button
                                        className="compose-post"
                                        disabled={this.state.status === ComposeStatus.SUBMITTING}
                                        onClick={this.handlePost}
                                    >
                                        {this.state.status === ComposeStatus.SUBMITTING ? (
                                            <FormattedMessage id="comments.posting" />
                                        ) : (
                                            <FormattedMessage id="comments.post" />
                                        )}
                                    </Button>
                                    <Button
                                        className="compose-cancel"
                                        onClick={this.handleCancel}
                                    >
                                        <FormattedMessage id="comments.cancel" />
                                    </Button>
                                    <span
                                        className={classNames('compose-limit',
                                            MAX_COMMENT_LENGTH - this.state.message.length >= 0 ?
                                                'compose-valid' : 'compose-invalid')}
                                    >
                                        <FormattedMessage
                                            id="comments.lengthWarning"
                                            values={{
                                                remainingCharacters: MAX_COMMENT_LENGTH - this.state.message.length
                                            }}
                                        />
                                    </span>
                                </FlexRow>
                            </Formsy>
                        </FlexRow>
                    </div>
                ) : null }
                {this.state.muteOpen ? (
                    <MuteModal
                        isOpen
                        showCloseButton
                        useStandardSizes
                        className="mod-mute"
                        muteModalMessages={this.getMuteMessageInfo()}
                        shouldCloseOnOverlayClick={false}
                        timeMuted={formatTime.formatRelativeTime(this.state.muteExpiresAtMs, window._locale)}
                        onRequestClose={this.handleMuteClose}
                    />
                ) : null}
            </React.Fragment>
        );
    }
}

ComposeComment.propTypes = {
    commenteeId: PropTypes.number,
    muteStatus: PropTypes.shape({
        offenses: PropTypes.array,
        muteExpiresAt: PropTypes.number
    }),
    onAddComment: PropTypes.func,
    onCancel: PropTypes.func,
    parentId: PropTypes.number,
    projectId: PropTypes.string,
    user: PropTypes.shape({
        id: PropTypes.number,
        username: PropTypes.string,
        token: PropTypes.string,
        thumbnailUrl: PropTypes.string
    })
};

const mapStateToProps = state => ({
    muteStatus: state.session.session.permissions.mute_status ?
        state.session.session.permissions.mute_status :
        {muteExpiresAt: 0, offenses: []},
    user: state.session.session.user
});

const ConnectedComposeComment = connect(
    mapStateToProps
)(ComposeComment);

module.exports = ConnectedComposeComment;
